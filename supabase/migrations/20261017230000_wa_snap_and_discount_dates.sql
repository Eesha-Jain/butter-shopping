-- Washington SNAP acceptance and discount dates that are weekly, monthly, or a specific day.

alter table public.stores
  add column if not exists accepts_snap boolean not null default false;

comment on column public.stores.accepts_snap is
  'True when the USDA SNAP retailer list includes this store. SNAP is a payment method, not a percent-off promotion.';

alter table public.promotions
  add column if not exists month_days int[],
  add column if not exists month_ordinals int[];

alter table public.promotions
  drop constraint if exists promotions_month_days_check,
  drop constraint if exists promotions_month_ordinals_check;

alter table public.promotions
  add constraint promotions_month_days_check
    check (month_days is null or month_days <@ array[
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]),
  add constraint promotions_month_ordinals_check
    check (month_ordinals is null or month_ordinals <@ array[-1, 1, 2, 3, 4, 5]);

comment on column public.promotions.month_days is
  'Calendar days of the month this discount applies, 1 through 31. Null means every day that the other rules allow.';
comment on column public.promotions.month_ordinals is
  'Which time the weekday occurs in the month. 1 is the first, 2 the second, -1 the last. Used with weekdays. Null means every occurrence.';

insert into public.discount_groups (code, name)
values
  ('senior', 'Senior'),
  ('veteran', 'Veteran'),
  ('student', 'Student')
on conflict (code) do nothing;

create or replace function public.promotion_applies_on(
  p_on date,
  p_weekdays int[],
  p_month_days int[],
  p_month_ordinals int[],
  p_starts timestamptz,
  p_ends timestamptz
)
returns boolean
language sql
immutable
as $$
  select p_starts < (p_on + 1)::timestamptz
    and p_ends > p_on::timestamptz
    and (p_weekdays is null or extract(dow from p_on)::int = any (p_weekdays))
    and (p_month_days is null or extract(day from p_on)::int = any (p_month_days))
    and (
      p_month_ordinals is null
      or (((extract(day from p_on)::int - 1) / 7) + 1) = any (p_month_ordinals)
      or (
        -1 = any (p_month_ordinals)
        and (p_on + 7) > (date_trunc('month', p_on) + interval '1 month - 1 day')::date
      )
    );
$$;

comment on function public.promotion_applies_on(date, int[], int[], int[], timestamptz, timestamptz) is
  'True when a promotion covers this calendar date. Weekdays, month days, and month ordinals each apply only when set. -1 means the last occurrence of that weekday in the month.';

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

create or replace function public.recommend_discount_date(
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_km numeric default 25
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_best date;
  v_best_value numeric := 0;
  v_day date;
  v_value numeric;
  v_offset int;
begin
  if auth.uid() is null then
    raise exception 'Sign in before choosing a discount day.';
  end if;

  for v_offset in 0..61 loop
    v_day := current_date + v_offset;
    select coalesce(sum(pmo.discount_value), 0)
      into v_value
    from public.promotions pmo
    where pmo.product_id is null
      and pmo.discount_type = 'percent_off'
      and public.promotion_applies_on(
        v_day, pmo.weekdays, pmo.month_days, pmo.month_ordinals, pmo.starts_at, pmo.ends_at
      )
      and (
        pmo.requires_group is null
        or exists (
          select 1 from public.discount_eligibilities de
          where de.user_id = auth.uid() and de.group_code = pmo.requires_group
        )
      )
      and exists (
        select 1
        from public.stores s
        where s.region = 'WA'
          and (s.id = pmo.store_id or s.chain_id = pmo.chain_id)
          and (
            p_latitude is null
            or p_longitude is null
            or s.latitude is null
            or s.longitude is null
            or public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) <= coalesce(p_radius_km, 25)
          )
      );
    if v_value > v_best_value then
      v_best_value := v_value;
      v_best := v_day;
    end if;
  end loop;

  return v_best;
end;
$$;

comment on function public.recommend_discount_date(double precision, double precision, numeric) is
  'The next calendar date in the coming two months when the caller''s opted-in basket discounts are largest at a Washington store. A first-Tuesday or 15th-of-the-month policy counts only on that date. Null when no matching discount exists.';

revoke all on function public.promotion_applies_on(date, int[], int[], int[], timestamptz, timestamptz) from public;
revoke all on function public.recommend_discount_date(double precision, double precision, numeric) from public;
grant execute on function public.recommend_discount_date(double precision, double precision, numeric) to authenticated;
