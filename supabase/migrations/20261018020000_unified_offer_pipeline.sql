-- Unified offer pipeline: observation metadata + trusted shelf for planning.
-- user_report beats newer api/scrape rows (same rule as client mergeOffers).

alter table public.prices
  add column if not exists regular_price_cents integer
    check (regular_price_cents is null or regular_price_cents >= 0),
  add column if not exists external_ref text;

comment on column public.prices.regular_price_cents is
  'Shelf regular price in cents when the observation also recorded a promo.';
comment on column public.prices.external_ref is
  'Retailer product id / SKU used for Collect idempotency.';

alter table public.promotions
  add column if not exists external_ref text;

create unique index if not exists promotions_external_ref_key
  on public.promotions (external_ref)
  where external_ref is not null;

comment on column public.promotions.external_ref is
  'Importer or weekly-ad id for upsert idempotency.';

create or replace view public.trusted_current_prices
with (security_invoker = true) as
select distinct on (store_product_id)
  store_product_id,
  price_cents,
  source,
  created_at,
  (now() - created_at) > interval '24 hours' as is_stale
from public.prices
order by
  store_product_id,
  case when source = 'user_report' then 0 else 1 end,
  created_at desc;

comment on view public.trusted_current_prices is
  'Trusted shelf price per listing: latest user_report wins over newer api/scrape. Used by price_options planning.';

grant select on public.trusted_current_prices to authenticated;

-- Planning Match step reads trusted shelf, then joins promotions.
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
    select
      tcp.store_product_id,
      tcp.price_cents,
      tcp.created_at
    from public.trusted_current_prices tcp
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
      where public.promotion_applies_on(
          p_planned_for,
          pmo.weekdays,
          pmo.month_days,
          pmo.month_ordinals,
          pmo.starts_at,
          pmo.ends_at
        )
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

comment on function public.price_options(
  uuid, uuid, uuid, date, numeric, numeric, boolean, double precision, double precision
) is
  'Match step: trusted shelf prices plus the best applicable promotion. Manual user_report shelf beats newer api/scrape.';
