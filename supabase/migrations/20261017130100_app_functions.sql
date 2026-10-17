-- Read models and the functions the app is expected to call.
-- Multi-row changes go through these functions so a list, trip, order, and
-- purchase cannot be left half-written.

-- ---------------------------------------------------------------------------
-- Pricing helpers
-- ---------------------------------------------------------------------------

create or replace function public.distance_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns numeric
language sql
immutable
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else round((6371 * acos(least(1::float8, greatest(-1::float8,
      cos(radians(p_lat1)) * cos(radians(p_lat2)) * cos(radians(p_lng2) - radians(p_lng1))
      + sin(radians(p_lat1)) * sin(radians(p_lat2))
    ))))::numeric, 3)
  end;
$$;

comment on function public.distance_km(double precision, double precision, double precision, double precision) is
  'Kilometers between two latitude/longitude pairs. Returns null when either point is missing. This replaces PostGIS for the small store list.';

create or replace function public.discounted_line_cents(
  p_unit_price_cents integer,
  p_quantity numeric,
  p_discount_type text,
  p_discount_value numeric
)
returns integer
language sql
immutable
as $$
  select case
    when p_unit_price_cents is null or p_quantity is null then null
    when p_discount_type = 'percent_off' then
      greatest(0, round(p_unit_price_cents * p_quantity * (1 - coalesce(p_discount_value, 0) / 100.0)))::int
    when p_discount_type = 'amount_off' then
      greatest(0, round((p_unit_price_cents - coalesce(p_discount_value, 0)) * p_quantity))::int
    when p_discount_type = 'bogo' then
      greatest(0, round(p_unit_price_cents * (p_quantity - floor(p_quantity / 2))))::int
    else round(p_unit_price_cents * p_quantity)::int
  end;
$$;

comment on function public.discounted_line_cents(integer, numeric, text, numeric) is
  'Line total in cents. percent_off uses discount_value as a percent. amount_off uses discount_value as cents off each unit. bogo charges for every other unit. A null discount type returns the shelf total.';

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view public.current_prices
with (security_invoker = true) as
select distinct on (store_product_id)
  store_product_id,
  price_cents,
  source,
  created_at,
  (now() - created_at) > interval '24 hours' as is_stale
from public.prices
order by store_product_id, created_at desc;

create or replace view public.current_unit_prices
with (security_invoker = true) as
select
  cp.store_product_id,
  cp.price_cents,
  cp.is_stale,
  p.size_base_amount,
  p.size_base_unit,
  case
    when p.size_base_amount > 0 then round(cp.price_cents / p.size_base_amount, 4)
    else null
  end as cents_per_base_unit
from public.current_prices cp
join public.store_products sp on sp.id = cp.store_product_id
join public.products p on p.id = sp.product_id;

create or replace view public.v_list_items
with (security_invoker = true) as
select
  li.id,
  li.list_id,
  li.quantity,
  li.amount_base,
  li.size_flexible,
  li.done_at,
  li.product_id,
  li.category_id,
  li.custom_name,
  li.source_recipe_id,
  coalesce(p.name, pc.name, li.custom_name) as display_name,
  best.store_product_id as best_store_product_id,
  best.price_cents as best_price_cents,
  best.is_stale as best_price_is_stale
from public.list_items li
left join public.products p on p.id = li.product_id
left join public.product_categories pc on pc.id = li.category_id
left join lateral (
  select cup.store_product_id, cup.price_cents, cup.is_stale
  from public.store_products sp
  join public.products prod on prod.id = sp.product_id
  join public.current_unit_prices cup on cup.store_product_id = sp.id
  where prod.is_active
    and sp.is_available
    and (
      (li.product_id is not null and prod.id = li.product_id)
      or (
        li.product_id is null
        and li.category_id is not null
        and prod.category_id = li.category_id
      )
    )
  order by cup.cents_per_base_unit asc nulls last, cup.price_cents asc
  limit 1
) best on true;

create or replace view public.v_order_summary
with (security_invoker = true) as
select
  o.id as order_id,
  o.trip_id,
  o.group_id,
  o.store_id,
  o.status,
  t.planned_for,
  t.fulfillment_method,
  t.delivery_location_id,
  o.expires_at,
  o.placed_at,
  o.confirmed_at,
  o.paid_by,
  o.checkout_url,
  count(oi.id) as item_count,
  coalesce(sum(round(oi.quantity * oi.unit_price_cents))::int, 0) as total_cents
from public.orders o
join public.shopping_trips t on t.id = o.trip_id
left join public.order_items oi on oi.order_id = o.id
group by o.id, t.planned_for, t.fulfillment_method, t.delivery_location_id;

create or replace view public.v_group_balances
with (security_invoker = true) as
select
  o.group_id,
  os.user_id,
  o.paid_by,
  sum(os.amount_cents) filter (where os.status = 'owed') as amount_owed_cents
from public.order_shares os
join public.orders o on o.id = os.order_id
where os.user_id <> o.paid_by
group by o.group_id, os.user_id, o.paid_by;

create or replace view public.v_recipe_detail
with (security_invoker = true) as
select
  r.id as recipe_id,
  r.title,
  r.servings,
  r.image_path,
  r.instructions,
  r.is_public,
  r.created_by,
  ri.id as ingredient_id,
  ri.raw_text,
  ri.category_id,
  ri.amount_base,
  (
    select min(cup.price_cents)
    from public.store_products sp
    join public.products p on p.id = sp.product_id
    join public.current_unit_prices cup on cup.store_product_id = sp.id
    where p.category_id = ri.category_id
      and p.is_active
      and sp.is_available
  ) as est_min_price_cents
from public.recipes r
join public.recipe_ingredients ri on ri.recipe_id = r.id;

create or replace view public.v_due_habits
with (security_invoker = true) as
select
  h.id,
  h.group_id,
  h.product_id,
  h.category_id,
  h.interval_days,
  h.usual_amount_base,
  h.next_due_on,
  h.auto_add_enabled
from public.item_habits h
where h.auto_add_enabled
  and h.next_due_on <= current_date;

create or replace view public.v_expiring_purchases
with (security_invoker = true) as
select
  pu.id,
  pu.group_id,
  pu.user_id,
  pu.store_product_id,
  pu.quantity,
  pu.expires_on,
  pu.purchased_at
from public.purchases pu
where pu.expires_on is not null
  and pu.expires_on >= current_date
  and pu.expires_on <= current_date + 2;

-- Aggregates only. security_invoker is off so campus-wide counts are not
-- limited to the caller's groups. Do not add user or group ids to this view.
create or replace view public.v_trending
with (security_invoker = false) as
select
  'product'::text as kind,
  p.id as product_id,
  null::uuid as recipe_id,
  pr.college_id,
  'organic'::text as source,
  count(distinct pu.user_id)::bigint as score,
  null::timestamptz as starts_at,
  null::timestamptz as ends_at
from public.purchases pu
join public.store_products sp on sp.id = pu.store_product_id
join public.products p on p.id = sp.product_id
join public.profiles pr on pr.id = pu.user_id
where pu.purchased_at > now() - interval '7 days'
  and p.is_active
group by p.id, pr.college_id
having count(distinct pu.user_id) >= 3
union all
select
  'recipe'::text,
  null::uuid,
  r.id,
  pr.college_id,
  'organic'::text,
  count(distinct l.group_id)::bigint,
  null::timestamptz,
  null::timestamptz
from public.list_items li
join public.lists l on l.id = li.list_id
join public.recipes r on r.id = li.source_recipe_id
join public.profiles pr on pr.id = li.added_by
where li.created_at > now() - interval '7 days'
  and r.is_public
group by r.id, pr.college_id
having count(distinct l.group_id) >= 3
union all
select
  case when s.product_id is not null then 'product' else 'recipe' end,
  s.product_id,
  s.recipe_id,
  s.college_id,
  'sponsored'::text,
  null::bigint,
  s.starts_at,
  s.ends_at
from public.sponsorships s
where s.starts_at <= now()
  and s.ends_at > now();

comment on view public.current_prices is
  'Newest shelf price for each store product. is_stale is true when that observation is older than 24 hours.';
comment on view public.current_unit_prices is
  'Newest price plus cents per g, ml, or ct. Compare foods in the same category with cents_per_base_unit.';
comment on view public.v_list_items is
  'A list row plus its display name and the cheapest active option. This price ignores food rules and promotions. Use recommend_shopping_plan for a group-aware plan.';
comment on view public.v_order_summary is
  'One order with its trip date, confirmation, item count, and frozen total cents.';
comment on view public.v_group_balances is
  'Unpaid shares. user_id owes paid_by amount_owed_cents. The payer does not owe themselves.';
comment on view public.v_recipe_detail is
  'A recipe and its ingredient lines. est_min_price_cents is the cheapest current shelf price in that ingredient category, not a food-rule-aware price.';
comment on view public.v_due_habits is
  'Group habits whose next_due_on is today or earlier and whose auto-add is enabled.';
comment on view public.v_expiring_purchases is
  'Purchases that expire today, tomorrow, or in two days. The reminder job sends a push only for purchases expiring in exactly two days.';
comment on view public.v_trending is
  'One feed of organic and sponsored products and recipes. source organic is a real count: distinct purchasers for a product, or distinct groups for a recipe, over seven days. source sponsored is a paid placement and its score is null. Never add a sponsored row into the organic score. A null college_id on an organic row means the purchaser or recipe adder has no college. A null college_id on a sponsored row means the placement is for every campus.';

-- ---------------------------------------------------------------------------
-- Group lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a group';
  end if;
  if p_kind not in ('household', 'event') then
    raise exception 'Create a household or an event. Personal groups are created at signup';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A group needs a name';
  end if;

  insert into public.groups (name, kind, invite_code, created_by)
  values (btrim(p_name), p_kind, encode(gen_random_bytes(6), 'hex'), auth.uid())
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'owner');

  insert into public.lists (group_id, name, is_default)
  values (v_group_id, 'Shopping list', true);

  return v_group_id;
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a group';
  end if;

  select id into v_group_id
  from public.groups
  where invite_code = p_invite_code
    and closed_at is null;

  if v_group_id is null then
    raise exception 'That invite code is invalid or the group is closed';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before leaving a group';
  end if;

  select kind into v_kind from public.groups where id = p_group_id;
  if v_kind is null then
    raise exception 'Group not found';
  end if;
  if v_kind = 'personal' then
    raise exception 'The personal grocery group cannot be left';
  end if;

  delete from public.group_members
  where group_id = p_group_id and user_id = auth.uid();

  if not found then
    raise exception 'You are not a member of this group';
  end if;
end;
$$;

comment on function public.create_group(text, text) is
  'Creates a household or event group, makes the caller the owner, and adds a default list. Returns the group id. Do not insert into groups directly or the default list will be missing. Personal groups already exist from signup.';
comment on function public.join_group(text) is
  'Adds the caller to an open group with a matching invite code. Returns the group id. Joining does not copy anyone else''s food rules or budget.';
comment on function public.leave_group(uuid) is
  'Removes the caller from a household or event. Refuses the personal group created at signup.';

-- ---------------------------------------------------------------------------
-- Catalog and planning
-- ---------------------------------------------------------------------------

create or replace function public.nearby_stores(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km numeric default 25
)
returns table (
  id uuid,
  name text,
  chain_id uuid,
  college_id uuid,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  distance_km numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id, s.name, s.chain_id, s.college_id, s.address_line1, s.city, s.region,
    s.postal_code, s.latitude, s.longitude,
    public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) as distance_km
  from public.stores s
  where s.latitude is not null
    and s.longitude is not null
    and public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) <= p_radius_km
  order by distance_km;
$$;

comment on function public.nearby_stores(double precision, double precision, numeric) is
  'Stores within p_radius_km of a latitude/longitude, nearest first. Stores without coordinates are omitted. Pass the device location or the user''s default saved address.';

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
  preferred_match boolean
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
  )
  select
    prod.id,
    sp.store_id,
    sp.id,
    latest.price_cents,
    public.discounted_line_cents(
      latest.price_cents, v_quantity, promo.discount_type, promo.discount_value
    ),
    case
      when prod.size_base_amount > 0 then round(latest.price_cents / prod.size_base_amount, 4)
      else null
    end,
    public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude),
    (now() - latest.created_at) > interval '24 hours',
    exists (
      select 1
      from public.product_traits pt
      join rules r on r.trait_id = pt.trait_id and r.mode = 'prefer'
      where pt.product_id = prod.id
        and pt.relation in ('suitable', 'certified')
    )
  from public.store_products sp
  join public.products prod on prod.id = sp.product_id
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
    );
end;
$$;

comment on function public.price_options(uuid, uuid, uuid, date, numeric, numeric, boolean, double precision, double precision) is
  'Comparable offers for one product or one category on a grocery date. Pass the group so the strictest current member rule applies: any avoid excludes contains and may_contain; any require demands suitable or certified; prefer only sets preferred_match. Missing traits stay unknown and are not treated as safe for a required rule. Discount eligibility is the caller''s, not the group''s. line_cents includes the best matching promotion. shelf_price_cents does not. Results are ordered by the caller.';

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
  over_budget boolean
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
    is_stale boolean
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
      insert into plan_choice values (item.id, v_name, null, null, null, null, null, null);
      continue;
    end if;

    insert into plan_choice
    select item.id, v_name, best.store_id, best.store_product_id, best.shelf_price_cents,
           best.line_cents, best.distance_km, best.is_stale
    from (
      select *
      from public.price_options(
        v_group_id, item.category_id, item.product_id, p_planned_for,
        item.quantity, item.amount_base, item.size_flexible, v_lat, v_lng
      ) po
      order by po.line_cents asc nulls last, po.distance_km asc nulls last
      limit 1
    ) best;

    if not found then
      insert into plan_choice values (item.id, v_name, null, null, null, null, null, null);
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
           limited.shelf_price_cents, limited.line_cents, limited.distance_km, limited.is_stale
    from plan_original o
    join public.list_items li on li.id = o.list_item_id
    join lateral (
      select po.*
      from public.price_options(
        v_group_id, li.category_id, li.product_id, p_planned_for,
        li.quantity, li.amount_base, li.size_flexible, v_lat, v_lng
      ) po
      where po.store_id in (select plan_keep.store_id from plan_keep)
      order by po.line_cents asc nulls last, po.distance_km asc nulls last
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
    (v_budget is not null and v_total > v_budget)
  from plan_choice c;
end;
$$;

comment on function public.recommend_shopping_plan(uuid, date, double precision, double precision) is
  'Builds a one-day plan for every unchecked item on a list. The date belongs to the caller; profiles.preferred_days is a hint the app should use before calling this. Each item is priced with price_options. The caller''s max_stores_per_trip keeps the busiest stores, and an item stays at another store only when the kept stores do not sell it. A custom item returns no store. over_budget compares the estimated promotional total with profiles.weekly_budget_cents. Rows with a null store_product_id are not ready to order.';

-- ---------------------------------------------------------------------------
-- Orders and purchases
-- ---------------------------------------------------------------------------

create or replace function public.create_trip_from_list(
  p_list_id uuid,
  p_planned_for date,
  p_fulfillment_method text default 'self_pickup',
  p_delivery_location_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_trip_id uuid;
  v_order_id uuid;
  v_store_id uuid;
  v_location_owner uuid;
  plan_row record;
begin
  select group_id into v_group_id from public.lists where id = p_list_id;
  if v_group_id is null or auth.uid() is null or not public.is_group_member(v_group_id) then
    raise exception 'List not found or you are not a member of its group';
  end if;

  if p_fulfillment_method not in ('self_pickup', 'store_pickup', 'delivery') then
    raise exception 'Choose self_pickup, store_pickup, or delivery';
  end if;

  if p_fulfillment_method = 'delivery' then
    if p_delivery_location_id is null then
      raise exception 'Delivery needs a saved home address (delivery_location_id)';
    end if;
    select user_id into v_location_owner
    from public.user_locations
    where id = p_delivery_location_id;
    if v_location_owner is null then
      raise exception 'Delivery address not found';
    end if;
    if v_location_owner <> auth.uid() and not public.is_group_member(v_group_id) then
      raise exception 'Delivery address must belong to a group member';
    end if;
    -- A location is owned by one user; any group member may ship to their own address.
    if v_location_owner <> auth.uid() then
      raise exception 'Use one of your own saved addresses for delivery';
    end if;
  elsif p_delivery_location_id is not null then
    raise exception 'Only a delivery trip stores a delivery address';
  end if;

  drop table if exists pg_temp.trip_plan;
  create temp table trip_plan on commit drop as
  select *
  from public.recommend_shopping_plan(p_list_id, p_planned_for, p_latitude, p_longitude)
  where store_product_id is not null;

  if not exists (select 1 from trip_plan) then
    raise exception 'Nothing on this list can be priced at a store yet';
  end if;

  insert into public.shopping_trips (
    group_id, planned_for, fulfillment_method, delivery_location_id
  )
  values (
    v_group_id, p_planned_for, p_fulfillment_method, p_delivery_location_id
  )
  returning id into v_trip_id;

  for v_store_id in select distinct store_id from trip_plan
  loop
    insert into public.orders (trip_id, group_id, store_id, expires_at)
    values (v_trip_id, v_group_id, v_store_id, (p_planned_for + 1)::timestamptz)
    returning id into v_order_id;

    insert into public.order_items (order_id, store_product_id, quantity, unit_price_cents, list_item_id)
    select
      v_order_id,
      tp.store_product_id,
      li.quantity,
      round(tp.line_cents / li.quantity)::int,
      tp.list_item_id
    from trip_plan tp
    join public.list_items li on li.id = tp.list_item_id
    where tp.store_id = v_store_id;
  end loop;

  return v_trip_id;
end;
$$;

create or replace function public.confirm_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before confirming an order';
  end if;

  update public.orders
  set paid_by = coalesce(paid_by, auth.uid()),
      confirmed_by = auth.uid(),
      confirmed_at = now()
  where id = p_order_id
    and status = 'draft'
    and public.is_group_member(group_id)
    and (expires_at is null or expires_at > now())
    and (paid_by is null or paid_by = auth.uid())
  returning id into v_id;

  if v_id is null then
    raise exception 'This draft cannot be confirmed. It may belong to another payer, be expired, or already be placed';
  end if;
end;
$$;

create or replace function public.finalize_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before placing an order';
  end if;

  update public.orders
  set status = 'ordered'
  where id = p_order_id
    and status = 'draft'
    and confirmed_by = auth.uid()
    and paid_by = auth.uid()
  returning id into v_id;

  if v_id is null then
    raise exception 'Confirm this order as its payer before placing it';
  end if;
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
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_price_cents is null or p_unit_price_cents < 0 then
    raise exception 'Quantity and price must be present and non-negative';
  end if;

  insert into public.purchases (
    user_id, group_id, store_product_id, quantity, unit_price_cents, purchased_at, expires_on
  )
  values (
    auth.uid(), p_group_id, p_store_product_id, p_quantity, p_unit_price_cents,
    coalesce(p_purchased_at, now()), p_expires_on
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.add_due_habit_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  habit record;
  v_added int := 0;
  v_next date;
begin
  for habit in
    select h.*, l.id as list_id
    from public.item_habits h
    join public.lists l on l.group_id = h.group_id and l.is_default
    where h.auto_add_enabled
      and h.next_due_on <= current_date
      and (auth.uid() is null or public.is_group_member(h.group_id))
  loop
    if not exists (
      select 1
      from public.list_items li
      where li.list_id = habit.list_id
        and li.done_at is null
        and (
          (habit.product_id is not null and li.product_id = habit.product_id)
          or (habit.category_id is not null and li.category_id = habit.category_id)
        )
    ) then
      insert into public.list_items (
        list_id, added_by, product_id, category_id, quantity, amount_base
      )
      values (
        habit.list_id, auth.uid(), habit.product_id, habit.category_id, 1, habit.usual_amount_base
      );
      v_added := v_added + 1;
    end if;

    v_next := habit.next_due_on + habit.interval_days;
    while v_next <= current_date loop
      v_next := v_next + habit.interval_days;
    end loop;

    update public.item_habits
    set next_due_on = v_next
    where id = habit.id;
  end loop;

  return v_added;
end;
$$;

comment on function public.create_trip_from_list(uuid, date, text, uuid, double precision, double precision) is
  'Creates a shopping trip for p_planned_for and one draft order per store returned by recommend_shopping_plan. p_fulfillment_method is self_pickup (shop in person), store_pickup (order for pickup), or delivery. Delivery requires p_delivery_location_id pointing at one of the caller''s saved user_locations; other methods must leave it null. order_items.unit_price_cents is the estimated promotional unit price. The draft expires at the start of the following UTC day. Returns the trip id. Items that cannot be priced stay on the list and are not copied onto an order.';
comment on function public.confirm_order(uuid) is
  'The caller confirms a draft and becomes its payer when no payer is set. Another member cannot confirm an order that already has a payer. Sends no push by itself; the app asks the notification function to notify this payer before confirmation.';
comment on function public.finalize_order(uuid) is
  'The confirming payer places the order. The database then freezes purchases and even expense shares. Do not set orders.status to ordered from the client.';
comment on function public.record_purchase(uuid, uuid, numeric, integer, date, timestamptz) is
  'Records one in-store receipt line. user_id is the caller, meaning the person who paid. expires_on is optional and cannot be changed later. This function does not attach the line to an order; placed orders create their own purchase rows.';
comment on function public.add_due_habit_items() is
  'Adds due group habits to each group''s default list and advances next_due_on. A habit belongs to the group. An open matching list item is not duplicated. A signed-in caller updates only their groups; the service role, whose auth.uid() is null, updates every group. Returns the number of list rows inserted.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

grant select on public.current_prices, public.current_unit_prices, public.v_list_items,
  public.v_order_summary, public.v_group_balances, public.v_recipe_detail,
  public.v_due_habits, public.v_expiring_purchases, public.v_trending
to authenticated;

do $$
declare
  fn text;
  functions text[] := array[
    'distance_km(double precision, double precision, double precision, double precision)',
    'discounted_line_cents(integer, numeric, text, numeric)',
    'nearby_stores(double precision, double precision, numeric)',
    'price_options(uuid, uuid, uuid, date, numeric, numeric, boolean, double precision, double precision)',
    'recommend_shopping_plan(uuid, date, double precision, double precision)',
    'create_group(text, text)',
    'join_group(text)',
    'leave_group(uuid)',
    'create_trip_from_list(uuid, date, text, uuid, double precision, double precision)',
    'confirm_order(uuid)',
    'finalize_order(uuid)',
    'record_purchase(uuid, uuid, numeric, integer, date, timestamptz)',
    'add_due_habit_items()'
  ];
begin
  foreach fn in array functions loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

do $$
begin
  grant execute on function public.add_due_habit_items() to service_role;
exception
  when undefined_object then null;
end $$;

-- Schedules are skipped when pg_cron or the Vault secrets are not present,
-- so the baseline migration still succeeds on a new project.
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
exception
  when insufficient_privilege or undefined_file or feature_not_supported then
    raise notice 'pg_cron or pg_net is not available in this database: %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'add-due-habits') then
    perform cron.schedule(
      'add-due-habits',
      '15 13 * * *',
      'select public.add_due_habit_items()'
    );
  end if;
exception
  when undefined_table or undefined_function or insufficient_privilege then
    raise notice 'Skipping habit schedule: %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'service_role_key')
     and not exists (select 1 from cron.job where jobname = 'send-due-reminders') then
    perform cron.schedule(
      'send-due-reminders',
      '30 13 * * *',
      $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/send-due-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'service_role_key')
     and not exists (select 1 from cron.job where jobname = 'sync-product-safety') then
    perform cron.schedule(
      'sync-product-safety',
      '0 12 * * *',
      $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/sync-product-safety',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  end if;
exception
  when undefined_table or undefined_function or insufficient_privilege then
    raise notice 'Skipping reminder schedule: %', sqlerrm;
end $$;
