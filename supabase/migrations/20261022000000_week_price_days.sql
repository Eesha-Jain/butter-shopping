-- Last 7 Pacific days of shelf prices, plus a removable demo week.
-- Wednesday (dow 3) in the demo is 5% cheaper so the next Wednesday is the day to shop.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.prices'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%source%'
  loop
    execute format('alter table public.prices drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.prices
  add constraint prices_source_check
  check (source in ('api', 'scrape', 'user_report', 'demo'));

comment on constraint prices_source_check on public.prices is
  'demo rows are a presentation week and can be deleted without touching live prices.';

create or replace view public.listing_day_prices
with (security_invoker = true)
as
with days as (
  select ((timezone('America/Los_Angeles', now()))::date - offs) as local_date
  from generate_series(0, 6) as offs
)
select
  sp.id as store_product_id,
  sp.store_id,
  sp.product_id,
  day.local_date,
  latest.price_cents
from public.store_products sp
cross join days day
join lateral (
  select p.price_cents
  from public.prices p
  where p.store_product_id = sp.id
    and (p.created_at at time zone 'America/Los_Angeles')::date <= day.local_date
    and p.price_cents > 0
  order by p.created_at desc
  limit 1
) latest on true;

comment on view public.listing_day_prices is
  'One shelf price per listing for each of the last 7 Pacific dates. A day with no new check keeps the latest earlier price.';

grant select on public.listing_day_prices to authenticated, anon;

create or replace function public.best_week_price_day(
  p_list_id uuid default null,
  p_near_postal_code text default '98195'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_postal text := coalesce(nullif(trim(p_near_postal_code), ''), '98195');
  v_past date;
  v_dow int;
  v_total int;
  v_shop date;
begin
  with scoped as (
    select ldp.local_date, ldp.product_id, ldp.price_cents, (p.brand = 'Demo') as is_demo
    from public.listing_day_prices ldp
    join public.stores s on s.id = ldp.store_id
    join public.products p on p.id = ldp.product_id
    where s.postal_code = v_postal
       or s.source = 'demo'
  ),
  list_items as (
    select li.product_id, li.quantity
    from public.list_items li
    where p_list_id is not null
      and li.list_id = p_list_id
      and li.done_at is null
      and li.product_id is not null
      and li.quantity > 0
  ),
  item_days as (
    select i.product_id, i.quantity, sc.local_date, min(sc.price_cents) as price_cents
    from list_items i
    join scoped sc on sc.product_id = i.product_id
    group by i.product_id, i.quantity, sc.local_date
  ),
  complete_items as (
    select product_id
    from item_days
    group by product_id
    having count(*) = 7
  ),
  list_totals as (
    select local_date, sum(price_cents * quantity)::int as total_cents
    from item_days
    where product_id in (select product_id from complete_items)
    group by local_date
  ),
  store_totals as (
    select local_date, round(percentile_cont(0.5) within group (order by price_cents))::int as total_cents
    from scoped
    where is_demo
       or not exists (select 1 from scoped where is_demo)
    group by local_date
  ),
  chosen as (
    select local_date, total_cents
    from (
      select local_date, total_cents from list_totals
      union all
      select local_date, total_cents from store_totals
      where not exists (select 1 from list_totals)
    ) totals
    order by total_cents asc, local_date desc
    limit 1
  )
  select local_date, total_cents
    into v_past, v_total
  from chosen;

  if v_past is null then
    return null;
  end if;

  v_dow := extract(dow from v_past)::int;
  v_shop := v_past;
  while v_shop < (timezone('America/Los_Angeles', now()))::date loop
    v_shop := v_shop + 7;
  end loop;

  return jsonb_build_object(
    'past_on', v_past,
    'dow', v_dow,
    'shop_on', v_shop,
    'total_cents', v_total
  );
end;
$$;

comment on function public.best_week_price_day(uuid, text) is
  'Cheapest Pacific date in the last 7 days, and the next date with that weekday. A list total is used when every compared item has a price all week. Otherwise the median is the demo week while those rows exist, then shelf prices at the ZIP.';

revoke all on function public.best_week_price_day(uuid, text) from public;
grant execute on function public.best_week_price_day(uuid, text) to authenticated, anon;

-- Demo week. Idempotent: replaces only rows tagged demo-week.
insert into public.chains (name)
values ('QFC'), ('Safeway'), ('Trader Joe''s')
on conflict do nothing;

insert into public.stores (
  name, chain_id, city, region, postal_code, country, latitude, longitude, source, source_ref
)
select
  shop.name,
  chain.id,
  'Seattle',
  'WA',
  '98195',
  'US',
  shop.latitude,
  shop.longitude,
  'demo',
  shop.source_ref
from (
  values
    ('QFC', 'QFC', 'demo-qfc-98195', 47.6553, -122.3035),
    ('Safeway', 'Safeway', 'demo-safeway-98195', 47.6612, -122.3130),
    ('Trader Joe''s', 'Trader Joe''s', 'demo-tj-98195', 47.6610, -122.3420)
) as shop(name, chain_name, source_ref, latitude, longitude)
join public.chains chain on lower(chain.name) = lower(shop.chain_name)
on conflict (source, source_ref) do update
set postal_code = excluded.postal_code,
    latitude = excluded.latitude,
    longitude = excluded.longitude;

insert into public.products (name, brand)
select item.name, 'Demo'
from (
  values
    ('Whole milk'),
    ('Eggs'),
    ('Bread'),
    ('Bananas'),
    ('Chicken breast'),
    ('Rice')
) as item(name)
where not exists (
  select 1 from public.products existing
  where existing.name = item.name and existing.brand = 'Demo'
);

insert into public.store_products (store_id, product_id, is_available)
select store.id, product.id, true
from public.stores store
join public.products product on product.brand = 'Demo'
where store.source = 'demo'
  and store.source_ref in ('demo-qfc-98195', 'demo-safeway-98195', 'demo-tj-98195')
on conflict (store_id, product_id) do update
set is_available = true;

delete from public.prices
where source = 'demo'
  and external_ref like 'demo-week:%';

insert into public.prices (store_product_id, price_cents, source, external_ref, created_at)
select
  listing.id,
  case
    when extract(dow from day.local_date)::int = 3
      then round(base.cents * 0.95)::int
    else base.cents
  end,
  'demo',
  'demo-week:' || store.source_ref || ':' || product.name || ':' || day.local_date::text,
  (day.local_date::timestamp + time '12:00') at time zone 'America/Los_Angeles'
from public.store_products listing
join public.stores store on store.id = listing.store_id
join public.products product on product.id = listing.product_id
join (
  values
    ('Whole milk', 399),
    ('Eggs', 349),
    ('Bread', 299),
    ('Bananas', 69),
    ('Chicken breast', 899),
    ('Rice', 549)
) as base(name, cents) on base.name = product.name
cross join (
  select ((timezone('America/Los_Angeles', now()))::date - offs) as local_date
  from generate_series(0, 6) as offs
) as day
where store.source = 'demo'
  and product.brand = 'Demo';
