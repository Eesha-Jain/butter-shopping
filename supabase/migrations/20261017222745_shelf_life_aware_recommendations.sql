-- Shelf-life–aware recommendations: catalog shelf life, waste-adjusted
-- effective unit cost in price_options / recommend_shopping_plan, and
-- default purchase expires_on from shelf life when not supplied.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.product_categories
  add column if not exists typical_shelf_life_days int
    check (typical_shelf_life_days is null or typical_shelf_life_days > 0);

alter table public.products
  add column if not exists shelf_life_days int
    check (shelf_life_days is null or shelf_life_days > 0);

comment on column public.product_categories.typical_shelf_life_days is
  'Expected days after purchase before a typical item in this category spoils under normal storage. Null means non-perishable or unknown for ranking.';
comment on column public.products.shelf_life_days is
  'Expected days after purchase before this packaged product spoils. Overrides product_categories.typical_shelf_life_days when set. Null falls back to the category, then to no waste penalty.';

comment on table public.product_categories is
  'A comparable shopping unit such as whole milk or eggs, not a dietary filter. base_unit is g, ml, or ct. typical_shelf_life_days is the default perishability for ranking. Child categories point at parent_id. Use food_traits for vegan, allergen, and certification filters.';
comment on table public.products is
  'A store-agnostic packaged product. upc is unique when present. shelf_life_days overrides the category typical when set. is_active false means the product was recalled or discontinued and must not be recommended; old purchases still point at it. ingredients_text is the package text for display. ingredients_updated_at changes only when that text changes.';
comment on table public.purchases is
  'An immutable receipt line. user_id is the person who paid, not the person who will eat the food. expires_on is set when known at purchase, or defaults from product/category shelf life. In-store purchases have a null order_id. Placed orders insert these rows automatically.';

-- Best-effort defaults for common perishable category name patterns.
update public.product_categories
set typical_shelf_life_days = case
  when lower(name) ~ '(uht|shelf.?stable).*(milk|dairy)' then 90
  when lower(name) ~ '(milk|yogurt|cream|half.?and.?half|kefir)' then 7
  when lower(name) ~ '(butter|cheese|sour cream)' then 21
  when lower(name) ~ '(bread|bagel|tortilla|bun|roll)' then 5
  when lower(name) ~ '(egg)' then 21
  when lower(name) ~ '(lettuce|spinach|salad|herb|produce|fruit|berry|vegetable|tomato|avocado)' then 5
  when lower(name) ~ '(chicken|beef|pork|turkey|meat|fish|seafood)' then 3
  when lower(name) ~ '(deli|lunch.?meat)' then 5
  when lower(name) ~ '(tofu)' then 7
  else typical_shelf_life_days
end
where typical_shelf_life_days is null
  and lower(name) ~ '(milk|yogurt|cream|half.?and.?half|kefir|butter|cheese|sour cream|bread|bagel|tortilla|bun|roll|egg|lettuce|spinach|salad|herb|produce|fruit|berry|vegetable|tomato|avocado|chicken|beef|pork|turkey|meat|fish|seafood|deli|lunch.?meat|tofu|uht|shelf.?stable)';

-- ---------------------------------------------------------------------------
-- Scoring helpers
-- ---------------------------------------------------------------------------

create or replace function public.usable_amount_base(
  p_pack_amount numeric,
  p_usage_per_day numeric,
  p_shelf_life_days integer
)
returns numeric
language sql
immutable
as $$
  select case
    when p_pack_amount is null or p_pack_amount <= 0 then null
    when p_usage_per_day is null or p_usage_per_day <= 0
         or p_shelf_life_days is null or p_shelf_life_days <= 0
      then p_pack_amount
    else least(p_pack_amount, p_usage_per_day * p_shelf_life_days::numeric)
  end;
$$;

comment on function public.usable_amount_base(numeric, numeric, integer) is
  'How much of a pack the household can finish before spoil. When usage or shelf life is missing, returns the full pack amount (no waste penalty).';

create or replace function public.resolve_usage_per_day(
  p_group_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_amount_base numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return null;
  end if;

  return coalesce(
    (
      select case
        when h.usual_amount_base is not null and h.interval_days > 0
          then h.usual_amount_base / h.interval_days::numeric
        else null
      end
      from public.item_habits h
      where h.group_id = p_group_id
        and h.product_id is not null
        and h.product_id = p_product_id
      limit 1
    ),
    (
      select case
        when h.usual_amount_base is not null and h.interval_days > 0
          then h.usual_amount_base / h.interval_days::numeric
        else null
      end
      from public.item_habits h
      where h.group_id = p_group_id
        and h.category_id is not null
        and h.category_id = coalesce(
          p_category_id,
          (select p.category_id from public.products p where p.id = p_product_id)
        )
      limit 1
    ),
    case
      when p_amount_base is not null and p_amount_base > 0 then p_amount_base / 7.0
      else null
    end
  );
end;
$$;

comment on function public.resolve_usage_per_day(uuid, uuid, uuid, numeric) is
  'Daily consumption in category base units. Prefers a product habit, then a category habit, then amount_base / 7 days. Null means ranking applies no waste penalty.';

-- ---------------------------------------------------------------------------
-- price_options (return type changes require drop)
-- ---------------------------------------------------------------------------

drop function if exists public.price_options(
  uuid, uuid, uuid, date, numeric, numeric, boolean, double precision, double precision
);

create or replace function public.price_options(
  p_group_id uuid,
  p_category_id uuid,
  p_product_id uuid,
  p_planned_for date,
  p_quantity numeric,
  p_amount_base numeric,
  p_size_flexible boolean,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns table (
  product_id uuid,
  store_id uuid,
  store_product_id uuid,
  shelf_price_cents integer,
  line_cents integer,
  cents_per_base_unit numeric,
  distance_km numeric,
  is_stale boolean,
  preferred_match boolean,
  shelf_life_days integer,
  usage_per_day numeric,
  usable_amount_base numeric,
  effective_cents_per_base numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_quantity numeric := coalesce(nullif(p_quantity, 0), 1);
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if p_product_id is null and p_category_id is null then
    raise exception 'Choose a product or a category';
  end if;
  if v_quantity < 0 then
    v_quantity := 1;
  end if;

  return query
  with rules as (
    select
      ufr.trait_id,
      case
        when bool_or(ufr.mode = 'avoid') then 'avoid'
        when bool_or(ufr.mode = 'require') then 'require'
        else 'prefer'
      end as mode
    from public.user_food_rules ufr
    join public.group_members gm on gm.user_id = ufr.user_id
    where gm.group_id = p_group_id
    group by ufr.trait_id
  ),
  latest as (
    select distinct on (pr.store_product_id)
      pr.store_product_id,
      pr.price_cents,
      pr.created_at
    from public.prices pr
    order by pr.store_product_id, pr.created_at desc
  ),
  offers as (
    select
      prod.id as product_id,
      sp.store_id,
      sp.id as store_product_id,
      latest.price_cents as shelf_price_cents,
      public.discounted_line_cents(
        latest.price_cents, v_quantity, promo.discount_type, promo.discount_value
      ) as line_cents,
      case
        when prod.size_base_amount > 0 then round(latest.price_cents / prod.size_base_amount, 4)
        else null
      end as cents_per_base_unit,
      public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) as distance_km,
      (now() - latest.created_at) > interval '24 hours' as is_stale,
      exists (
        select 1
        from public.product_traits pt
        join rules r on r.trait_id = pt.trait_id and r.mode = 'prefer'
        where pt.product_id = prod.id
          and pt.relation in ('suitable', 'certified')
      ) as preferred_match,
      coalesce(prod.shelf_life_days, pc.typical_shelf_life_days) as shelf_life_days,
      public.resolve_usage_per_day(
        p_group_id, prod.id, coalesce(p_category_id, prod.category_id), p_amount_base
      ) as usage_per_day,
      case
        when prod.size_base_amount is not null and prod.size_base_amount > 0
          then prod.size_base_amount * v_quantity
        else null
      end as pack_amount
    from public.store_products sp
    join public.products prod on prod.id = sp.product_id
    left join public.product_categories pc on pc.id = prod.category_id
    join public.stores s on s.id = sp.store_id
    join latest on latest.store_product_id = sp.id
    left join lateral (
      select pmo.discount_type, pmo.discount_value
      from public.promotions pmo
      where pmo.starts_at < (p_planned_for + 1)::timestamptz
        and pmo.ends_at > p_planned_for::timestamptz
        and (pmo.weekdays is null or extract(dow from p_planned_for)::int = any (pmo.weekdays))
        and (pmo.store_id = s.id or pmo.chain_id = s.chain_id)
        and (pmo.product_id is null or pmo.product_id = prod.id)
        and (
          pmo.requires_group is null
          or exists (
            select 1 from public.discount_eligibilities de
            where de.user_id = auth.uid() and de.group_code = pmo.requires_group
          )
        )
      order by case when pmo.product_id is not null then 0 else 1 end, pmo.discount_value desc
      limit 1
    ) promo on true
    where prod.is_active
      and sp.is_available
      and (
        (p_product_id is not null and prod.id = p_product_id)
        or (p_product_id is null and prod.category_id = p_category_id)
      )
      and (
        coalesce(p_size_flexible, true)
        or p_amount_base is null
        or prod.size_base_amount is null
        or prod.size_base_amount between p_amount_base * 0.98 and p_amount_base * 1.02
      )
      and not exists (
        select 1
        from public.product_traits pt
        join rules r on r.trait_id = pt.trait_id and r.mode = 'avoid'
        where pt.product_id = prod.id
          and pt.relation in ('contains', 'may_contain')
      )
      and not exists (
        select 1
        from rules r
        where r.mode = 'require'
          and not exists (
            select 1 from public.product_traits pt
            where pt.product_id = prod.id
              and pt.trait_id = r.trait_id
              and pt.relation in ('suitable', 'certified')
          )
      )
  )
  select
    o.product_id,
    o.store_id,
    o.store_product_id,
    o.shelf_price_cents,
    o.line_cents,
    o.cents_per_base_unit,
    o.distance_km,
    o.is_stale,
    o.preferred_match,
    o.shelf_life_days,
    o.usage_per_day,
    public.usable_amount_base(o.pack_amount, o.usage_per_day, o.shelf_life_days),
    case
      when public.usable_amount_base(o.pack_amount, o.usage_per_day, o.shelf_life_days) > 0
        then round(
          o.line_cents::numeric
          / public.usable_amount_base(o.pack_amount, o.usage_per_day, o.shelf_life_days),
          4
        )
      else null
    end
  from offers o;
end;
$$;

comment on function public.price_options(uuid, uuid, uuid, date, numeric, numeric, boolean, double precision, double precision) is
  'Comparable offers for one product or one category on a grocery date. Pass the group so the strictest current member rule applies: any avoid excludes contains and may_contain; any require demands suitable or certified; prefer only sets preferred_match. Missing traits stay unknown and are not treated as safe for a required rule. Discount eligibility is the caller''s, not the group''s. line_cents includes the best matching promotion. shelf_price_cents does not. effective_cents_per_base is waste-adjusted using shelf life and group usage (habits, else amount_base/7). Callers should order by effective_cents_per_base, then line_cents, then distance.';

-- ---------------------------------------------------------------------------
-- recommend_shopping_plan
-- ---------------------------------------------------------------------------

drop function if exists public.recommend_shopping_plan(
  uuid, date, double precision, double precision
);

create or replace function public.recommend_shopping_plan(
  p_list_id uuid,
  p_planned_for date,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns table (
  list_item_id uuid,
  display_name text,
  store_id uuid,
  store_product_id uuid,
  shelf_price_cents integer,
  line_cents integer,
  distance_km numeric,
  is_stale boolean,
  over_budget boolean,
  effective_cents_per_base numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_max_stores int;
  v_budget int;
  v_lat double precision;
  v_lng double precision;
  v_store_count int;
  v_total int;
  item record;
  v_name text;
begin
  select l.group_id into v_group_id from public.lists l where l.id = p_list_id;
  if v_group_id is null or auth.uid() is null or not public.is_group_member(v_group_id) then
    raise exception 'List not found or you are not a member of its group';
  end if;

  select coalesce(max_stores_per_trip, 1), weekly_budget_cents
    into v_max_stores, v_budget
  from public.profiles
  where id = auth.uid();

  if p_latitude is null or p_longitude is null then
    select ul.latitude, ul.longitude into v_lat, v_lng
    from public.user_locations ul
    where ul.user_id = auth.uid() and ul.is_default
    order by ul.updated_at desc
    limit 1;
  else
    v_lat := p_latitude;
    v_lng := p_longitude;
  end if;

  drop table if exists pg_temp.plan_choice;
  create temp table plan_choice (
    list_item_id uuid,
    display_name text,
    store_id uuid,
    store_product_id uuid,
    shelf_price_cents int,
    line_cents int,
    distance_km numeric,
    is_stale boolean,
    effective_cents_per_base numeric
  ) on commit drop;

  for item in
    select li.*
    from public.list_items li
    where li.list_id = p_list_id and li.done_at is null
  loop
    select coalesce(p.name, c.name, item.custom_name)
      into v_name
    from (select 1) dummy
    left join public.products p on p.id = item.product_id
    left join public.product_categories c on c.id = item.category_id;

    if item.custom_name is not null then
      insert into plan_choice values (item.id, v_name, null, null, null, null, null, null, null);
      continue;
    end if;

    insert into plan_choice
    select item.id, v_name, best.store_id, best.store_product_id, best.shelf_price_cents,
           best.line_cents, best.distance_km, best.is_stale, best.effective_cents_per_base
    from (
      select *
      from public.price_options(
        v_group_id, item.category_id, item.product_id, p_planned_for,
        item.quantity, item.amount_base, item.size_flexible, v_lat, v_lng
      ) po
      order by
        po.effective_cents_per_base asc nulls last,
        po.line_cents asc nulls last,
        po.distance_km asc nulls last
      limit 1
    ) best;

    if not found then
      insert into plan_choice values (item.id, v_name, null, null, null, null, null, null, null);
    end if;
  end loop;

  select count(distinct store_id) into v_store_count
  from plan_choice
  where store_id is not null;

  if v_store_count > v_max_stores then
    drop table if exists pg_temp.plan_keep;
    drop table if exists pg_temp.plan_original;
    execute
      'create temp table plan_keep on commit drop as
         select store_id
         from plan_choice
         where store_id is not null
         group by store_id
         order by count(*) desc, coalesce(sum(line_cents), 0) asc
         limit $1'
    using v_max_stores;

    create temp table plan_original on commit drop as
    select * from plan_choice;

    delete from plan_choice c
    where c.store_id is not null
      and not exists (select 1 from plan_keep k where k.store_id = c.store_id);

    insert into plan_choice
    select o.list_item_id, o.display_name, limited.store_id, limited.store_product_id,
           limited.shelf_price_cents, limited.line_cents, limited.distance_km, limited.is_stale,
           limited.effective_cents_per_base
    from plan_original o
    join public.list_items li on li.id = o.list_item_id
    join lateral (
      select po.*
      from public.price_options(
        v_group_id, li.category_id, li.product_id, p_planned_for,
        li.quantity, li.amount_base, li.size_flexible, v_lat, v_lng
      ) po
      where po.store_id in (select plan_keep.store_id from plan_keep)
      order by
        po.effective_cents_per_base asc nulls last,
        po.line_cents asc nulls last,
        po.distance_km asc nulls last
      limit 1
    ) limited on true
    where not exists (
      select 1 from plan_choice c where c.list_item_id = o.list_item_id
    );

    insert into plan_choice
    select o.*
    from plan_original o
    where not exists (
      select 1 from plan_choice c where c.list_item_id = o.list_item_id
    );
  end if;

  select coalesce(sum(line_cents), 0) into v_total from plan_choice;

  return query
  select
    c.list_item_id, c.display_name, c.store_id, c.store_product_id,
    c.shelf_price_cents, c.line_cents, c.distance_km, c.is_stale,
    (v_budget is not null and v_total > v_budget),
    c.effective_cents_per_base
  from plan_choice c;
end;
$$;

comment on function public.recommend_shopping_plan(uuid, date, double precision, double precision) is
  'Builds a one-day plan for every unchecked item on a list. The date belongs to the caller; profiles.preferred_days is a hint the app should use before calling this. Each item is priced with price_options and ranked by effective_cents_per_base (waste-adjusted), then line_cents, then distance. over_budget still compares the sum of line_cents with weekly_budget_cents. The caller''s max_stores_per_trip keeps the busiest stores, and an item stays at another store only when the kept stores do not sell it. A custom item returns no store. Rows with a null store_product_id are not ready to order.';

-- ---------------------------------------------------------------------------
-- Default expires_on from shelf life
-- ---------------------------------------------------------------------------

create or replace function public.place_order_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_count int;
  v_share int;
begin
  if tg_op <> 'UPDATE' or new.status <> 'ordered' or old.status = 'ordered' then
    return new;
  end if;
  if new.confirmed_at is null or new.confirmed_by is null or new.paid_by is null then
    raise exception 'The buyer must confirm this order before it is placed';
  end if;
  if auth.uid() is not null and auth.uid() <> new.paid_by and not public.is_admin() then
    raise exception 'Only the payer can place this order';
  end if;

  new.placed_at = coalesce(new.placed_at, now());

  insert into public.purchases (
    user_id, group_id, store_product_id, quantity, unit_price_cents, order_id, purchased_at, expires_on
  )
  select
    new.paid_by,
    new.group_id,
    oi.store_product_id,
    oi.quantity,
    oi.unit_price_cents,
    new.id,
    new.placed_at,
    case
      when coalesce(p.shelf_life_days, pc.typical_shelf_life_days) is not null
        then (new.placed_at::date + coalesce(p.shelf_life_days, pc.typical_shelf_life_days))
      else null
    end
  from public.order_items oi
  join public.store_products sp on sp.id = oi.store_product_id
  join public.products p on p.id = sp.product_id
  left join public.product_categories pc on pc.id = p.category_id
  where oi.order_id = new.id
    and not exists (
      select 1 from public.purchases pu where pu.order_id = new.id
    );

  select coalesce(sum(round(quantity * unit_price_cents))::int, 0)
    into v_total
  from public.order_items
  where order_id = new.id;

  select count(*) into v_count from public.group_members where group_id = new.group_id;
  if v_count > 0 then
    v_share = v_total / v_count;
    insert into public.order_shares (order_id, user_id, amount_cents, status)
    select new.id, gm.user_id, v_share, 'owed'
    from public.group_members gm
    where gm.group_id = new.group_id
      and gm.user_id <> new.paid_by
    on conflict (order_id, user_id) do nothing;
  end if;

  update public.shopping_trips
  set status = 'ordered'
  where id = new.trip_id
    and status = 'draft'
    and not exists (
      select 1 from public.orders o
      where o.trip_id = new.trip_id and o.id <> new.id and o.status = 'draft'
    );

  return new;
end;
$$;

create or replace function public.record_purchase(
  p_group_id uuid,
  p_store_product_id uuid,
  p_quantity numeric,
  p_unit_price_cents integer,
  p_expires_on date default null,
  p_purchased_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_expires date := p_expires_on;
  v_shelf int;
  v_purchased_at timestamptz := coalesce(p_purchased_at, now());
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_price_cents is null or p_unit_price_cents < 0 then
    raise exception 'Quantity and price must be present and non-negative';
  end if;

  if v_expires is null then
    select coalesce(p.shelf_life_days, pc.typical_shelf_life_days)
      into v_shelf
    from public.store_products sp
    join public.products p on p.id = sp.product_id
    left join public.product_categories pc on pc.id = p.category_id
    where sp.id = p_store_product_id;

    if v_shelf is not null then
      v_expires := v_purchased_at::date + v_shelf;
    end if;
  end if;

  insert into public.purchases (
    user_id, group_id, store_product_id, quantity, unit_price_cents, purchased_at, expires_on
  )
  values (
    auth.uid(), p_group_id, p_store_product_id, p_quantity, p_unit_price_cents,
    v_purchased_at, v_expires
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_purchase(uuid, uuid, numeric, integer, date, timestamptz) is
  'Records one in-store receipt line. user_id is the caller, meaning the person who paid. expires_on is optional; when omitted it defaults from product or category shelf life. This function does not attach the line to an order; placed orders create their own purchase rows.';

comment on function public.place_order_snapshot() is
  'When an order status becomes ordered, writes immutable purchases for the payer (with expires_on from product/category shelf life) and even expense shares for the other members. The payer absorbs leftover cents.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
  functions text[] := array[
    'usable_amount_base(numeric, numeric, integer)',
    'price_options(uuid, uuid, uuid, date, numeric, numeric, boolean, double precision, double precision)',
    'recommend_shopping_plan(uuid, date, double precision, double precision)',
    'record_purchase(uuid, uuid, numeric, integer, date, timestamptz)'
  ];
begin
  foreach fn in array functions loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;

  -- Internal helper used by price_options; not part of the client API.
  revoke all on function public.resolve_usage_per_day(uuid, uuid, uuid, numeric) from public;
  revoke all on function public.resolve_usage_per_day(uuid, uuid, uuid, numeric) from anon, authenticated;
end $$;
