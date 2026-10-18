-- PL/pgSQL RETURNS TABLE columns are variables. Unqualified store_id / line_cents
-- on plan_choice conflicted with those OUT params ("column reference store_id is ambiguous").

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

  select count(distinct pc.store_id) into v_store_count
  from plan_choice pc
  where pc.store_id is not null;

  if v_store_count > v_max_stores then
    drop table if exists pg_temp.plan_keep;
    drop table if exists pg_temp.plan_original;
    execute
      'create temp table plan_keep on commit drop as
         select pc.store_id
         from plan_choice pc
         where pc.store_id is not null
         group by pc.store_id
         order by count(*) desc, coalesce(sum(pc.line_cents), 0) asc
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

  select coalesce(sum(pc.line_cents), 0) into v_total from plan_choice pc;

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
