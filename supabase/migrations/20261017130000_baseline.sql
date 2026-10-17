-- Butter Shopping baseline.
-- This migration replaces the draft application schema. It is safe on a
-- database whose application tables were created from the old schema.sql,
-- and it does not remove Supabase Auth or Storage internals.
--
-- Weekdays everywhere are Postgres extract(dow) numbers: 0 = Sunday ... 6 = Saturday.
-- Money is integer cents. Amounts use the category base unit: g, ml, or ct.

-- ---------------------------------------------------------------------------
-- Wipe the previous application schema completely
-- Policies must go before helper functions such as is_admin(), then tables,
-- views, and functions. Auth, Storage buckets metadata, and Vault stay intact.
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;

-- Storage policies from the old draft (depend on public.is_admin()).
drop policy if exists "avatars_select_all" on storage.objects;
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;
drop policy if exists "public_assets_select_all" on storage.objects;
drop policy if exists "public_assets_admin_write" on storage.objects;
drop policy if exists avatars_select_all on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;
drop policy if exists public_assets_select_all on storage.objects;
drop policy if exists public_assets_admin_write on storage.objects;

-- Every RLS policy in public (old draft names vary).
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  end loop;
end $$;

-- Drop PostGIS before wiping views/tables. Its system views
-- (geography_columns, geometry_columns, spatial_ref_sys) cannot be dropped
-- while the extension still owns them.
drop extension if exists postgis cascade;

-- Materialized views, then ordinary views, then tables.
-- Skip anything still owned by an extension (pgcrypto, etc.).
do $$
declare
  r record;
begin
  for r in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and c.relkind = 'm'
      and d.objid is null
  loop
    execute format('drop materialized view if exists public.%I cascade', r.name);
  end loop;

  for r in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and c.relkind = 'v'
      and d.objid is null
  loop
    execute format('drop view if exists public.%I cascade', r.name);
  end loop;

  for r in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and c.relkind = 'r'
      and d.objid is null
  loop
    execute format('drop table if exists public.%I cascade', r.name);
  end loop;
end $$;

-- Application functions in public. CASCADE clears leftover dependents.
-- Skip extension-owned routines (pgcrypto, etc.).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d
      on d.objid = p.oid
     and d.deptype = 'e'
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and d.objid is null
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Sets updated_at to the current time before a row update. Attach it to mutable tables.';

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  logo_path text,
  style jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table public.dining_plans (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chains (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (name = btrim(name) and length(name) > 0)
);

create unique index chains_name_lower_key on public.chains (lower(name));

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  chain_id uuid references public.chains(id) on delete set null,
  college_id uuid references public.colleges(id) on delete set null,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  source text not null,
  source_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_ref),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create index stores_college_idx on public.stores (college_id);
create index stores_chain_idx on public.stores (chain_id);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.product_categories(id) on delete set null,
  base_unit text not null check (base_unit in ('g', 'ml', 'ct')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (name = btrim(name) and length(name) > 0)
);

create unique index product_categories_name_lower_key on public.product_categories (lower(name));
create index product_categories_parent_idx on public.product_categories (parent_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  upc text,
  category_id uuid references public.product_categories(id) on delete set null,
  size_base_amount numeric check (size_base_amount is null or size_base_amount > 0),
  size_base_unit text check (size_base_unit in ('g', 'ml', 'ct')),
  image_path text,
  ingredients_text text,
  ingredients_updated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index products_upc_key on public.products (upc) where upc is not null;
create index products_category_idx on public.products (category_id);

create table public.store_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_sku text,
  product_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_id)
);

create index store_products_product_idx on public.store_products (product_id);

create table public.discount_groups (
  code text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code = lower(code))
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  chain_id uuid references public.chains(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  discount_type text not null check (discount_type in ('percent_off', 'amount_off', 'bogo')),
  discount_value numeric not null default 0,
  requires_group text references public.discount_groups(code) on delete set null,
  weekdays int[] check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_id is not null or chain_id is not null),
  check (ends_at > starts_at),
  check (
    (discount_type = 'percent_off' and discount_value >= 0 and discount_value <= 100)
    or (discount_type = 'amount_off' and discount_value >= 0)
    or (discount_type = 'bogo')
  )
);

create index promotions_store_idx on public.promotions (store_id);
create index promotions_chain_idx on public.promotions (chain_id);
create index promotions_product_idx on public.promotions (product_id);
create index promotions_window_idx on public.promotions (starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Food traits
-- ---------------------------------------------------------------------------

create table public.food_traits (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  kind text not null check (kind in ('ingredient', 'allergen', 'chemical', 'dietary', 'certification')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code = lower(code))
);

create unique index food_traits_code_key on public.food_traits (code);

create table public.product_traits (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  trait_id uuid not null references public.food_traits(id) on delete cascade,
  relation text not null check (relation in ('contains', 'may_contain', 'suitable', 'certified')),
  source text not null check (source in ('external', 'model', 'user_report', 'manual')),
  observed_at timestamptz not null default now(),
  unique (product_id, trait_id, relation)
);

create index product_traits_trait_idx on public.product_traits (trait_id);

-- ---------------------------------------------------------------------------
-- People, groups, and lists
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  college_id uuid references public.colleges(id) on delete set null,
  dining_plan_id uuid references public.dining_plans(id) on delete set null,
  weekly_budget_cents int check (weekly_budget_cents is null or weekly_budget_cents >= 0),
  preferred_days int[] check (preferred_days <@ array[0, 1, 2, 3, 4, 5, 6]),
  max_stores_per_trip int check (max_stores_per_trip is null or max_stores_per_trip > 0),
  transport_mode text check (transport_mode in ('walk', 'bike', 'drive', 'transit', 'rideshare')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create index user_locations_user_idx on public.user_locations (user_id);

create table public.user_stores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

create table public.discount_eligibilities (
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_code text not null references public.discount_groups(code) on delete cascade,
  consented_at timestamptz not null default now(),
  primary key (user_id, group_code)
);

create table public.user_food_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trait_id uuid not null references public.food_traits(id) on delete cascade,
  mode text not null check (mode in ('avoid', 'require', 'prefer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, trait_id)
);

create index user_food_rules_user_idx on public.user_food_rules (user_id);

create table public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('personal', 'household', 'event')),
  invite_code text unique,
  created_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lists_group_idx on public.lists (group_id);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.product_categories(id) on delete set null,
  custom_name text,
  quantity numeric not null default 1 check (quantity > 0),
  amount_base numeric check (amount_base is null or amount_base > 0),
  size_flexible boolean not null default true,
  source_recipe_id uuid,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(product_id, category_id, custom_name) = 1)
);

create index list_items_list_idx on public.list_items (list_id);
create index list_items_recipe_idx on public.list_items (source_recipe_id);

create table public.item_habits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  interval_days int not null check (interval_days > 0),
  usual_amount_base numeric check (usual_amount_base is null or usual_amount_base > 0),
  next_due_on date not null,
  auto_add_enabled boolean not null default true,
  source text not null check (source in ('user', 'inferred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(product_id, category_id) = 1)
);

create unique index item_habits_group_product_key
  on public.item_habits (group_id, product_id) where product_id is not null;
create unique index item_habits_group_category_key
  on public.item_habits (group_id, category_id) where category_id is not null;

-- ---------------------------------------------------------------------------
-- Trips, orders, and purchases
-- ---------------------------------------------------------------------------

create table public.shopping_trips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  planned_for date not null,
  -- How the group will receive this trip's groceries.
  -- self_pickup: a member goes to the store and shops.
  -- store_pickup: the store prepares the order and a member picks it up.
  -- delivery: the store delivers to delivery_location_id.
  fulfillment_method text not null default 'self_pickup'
    check (fulfillment_method in ('self_pickup', 'store_pickup', 'delivery')),
  delivery_location_id uuid references public.user_locations(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (fulfillment_method = 'delivery' and delivery_location_id is not null)
    or (fulfillment_method <> 'delivery' and delivery_location_id is null)
  )
);

create index shopping_trips_group_idx on public.shopping_trips (group_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.shopping_trips(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'cancelled')),
  expires_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  checkout_url text,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((confirmed_by is null) = (confirmed_at is null))
);

create index orders_trip_idx on public.orders (trip_id);
create index orders_group_idx on public.orders (group_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_price_cents int not null check (unit_price_cents >= 0),
  list_item_id uuid references public.list_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);

create table public.order_shares (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'owed' check (status in ('owed', 'paid')),
  settled_via text check (settled_via in ('manual')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, user_id),
  check ((status = 'paid') = (settled_at is not null))
);

create index order_shares_user_idx on public.order_shares (user_id);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_price_cents int not null check (unit_price_cents >= 0),
  order_id uuid references public.orders(id) on delete set null,
  purchased_at timestamptz not null default now(),
  expires_on date
);

create index purchases_group_idx on public.purchases (group_id);
create index purchases_order_idx on public.purchases (order_id);
create index purchases_expires_idx on public.purchases (expires_on) where expires_on is not null;

-- Prices are appended after profiles exist because a student can submit one.
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  price_cents int not null check (price_cents >= 0),
  source text not null check (source in ('api', 'scrape', 'user_report')),
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index prices_store_product_time_idx on public.prices (store_product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Recipes, sponsorships, and push tokens
-- ---------------------------------------------------------------------------

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_url text unique,
  video_url text,
  instructions text,
  servings int check (servings is null or servings > 0),
  image_path text,
  created_by uuid references public.profiles(id) on delete set null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.list_items
  add constraint list_items_source_recipe_fkey
  foreign key (source_recipe_id) references public.recipes(id) on delete set null;

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  raw_text text not null,
  category_id uuid references public.product_categories(id) on delete set null,
  amount_base numeric check (amount_base is null or amount_base > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);

create table public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete cascade,
  college_id uuid references public.colleges(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(product_id, recipe_id) = 1),
  check (ends_at > starts_at)
);

create index sponsorships_window_idx on public.sponsorships (starts_at, ends_at);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

create or replace function public.enforce_product_size_unit()
returns trigger
language plpgsql
as $$
declare
  v_unit text;
begin
  if new.category_id is not null and new.size_base_unit is not null then
    select base_unit into v_unit from public.product_categories where id = new.category_id;
    if v_unit is distinct from new.size_base_unit then
      raise exception 'Product size unit must match its category base unit';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_size_unit
  before insert or update on public.products
  for each row execute function public.enforce_product_size_unit();

create or replace function public.enforce_product_trait_relation()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.food_traits where id = new.trait_id;
  if v_kind in ('ingredient', 'allergen', 'chemical')
     and new.relation not in ('contains', 'may_contain') then
    raise exception 'Ingredients, allergens, and chemicals use contains or may_contain';
  elsif v_kind = 'dietary' and new.relation <> 'suitable' then
    raise exception 'Dietary traits use suitable';
  elsif v_kind = 'certification' and new.relation <> 'certified' then
    raise exception 'Certifications use certified';
  elsif v_kind is null then
    raise exception 'Unknown food trait';
  end if;
  return new;
end;
$$;

create trigger product_traits_relation
  before insert or update on public.product_traits
  for each row execute function public.enforce_product_trait_relation();

create or replace function public.enforce_user_food_rule()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.food_traits where id = new.trait_id;
  if v_kind in ('ingredient', 'allergen', 'chemical') and new.mode <> 'avoid' then
    raise exception 'Ingredients, allergens, and chemicals can only be avoided';
  elsif v_kind in ('dietary', 'certification') and new.mode not in ('require', 'prefer') then
    raise exception 'Dietary properties and certifications can be required or preferred';
  elsif v_kind is null then
    raise exception 'Unknown food trait';
  end if;
  return new;
end;
$$;

create trigger user_food_rules_mode
  before insert or update on public.user_food_rules
  for each row execute function public.enforce_user_food_rule();

create or replace function public.enforce_order_trip_group()
returns trigger
language plpgsql
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from public.shopping_trips where id = new.trip_id;
  if v_group_id is distinct from new.group_id then
    raise exception 'An order must belong to the same group as its shopping trip';
  end if;
  return new;
end;
$$;

create trigger orders_match_trip_group
  before insert or update of trip_id, group_id on public.orders
  for each row execute function public.enforce_order_trip_group();

-- Placing an order freezes its money. The payer keeps any remainder cents
-- after an even split; every other current member owes the floor share.
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
    user_id, group_id, store_product_id, quantity, unit_price_cents, order_id, purchased_at
  )
  select new.paid_by, new.group_id, oi.store_product_id, oi.quantity,
         oi.unit_price_cents, new.id, new.placed_at
  from public.order_items oi
  where oi.order_id = new.id
    and not exists (
      select 1 from public.purchases p where p.order_id = new.id
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

create trigger orders_place_snapshot
  before update of status on public.orders
  for each row execute function public.place_order_snapshot();

-- updated_at
do $$
declare
  t text;
  tables text[] := array[
    'colleges', 'dining_plans', 'chains', 'stores', 'product_categories', 'products',
    'store_products', 'discount_groups', 'promotions', 'food_traits', 'profiles',
    'user_locations', 'user_food_rules', 'groups', 'group_members', 'lists',
    'list_items', 'item_habits', 'shopping_trips', 'orders', 'order_items',
    'order_shares', 'recipes', 'recipe_ingredients', 'sponsorships', 'push_tokens'
  ];
begin
  foreach t in array tables loop
    execute format(
      'drop trigger if exists set_updated_at on %I;
       create trigger set_updated_at before update on %I
       for each row execute function public.set_updated_at();', t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Signup and access helpers
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;

  insert into public.groups (name, kind, created_by)
  values ('My Groceries', 'personal', new.id)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, new.id, 'owner');

  insert into public.lists (group_id, name, is_default)
  values (v_group_id, 'My List', true);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'colleges', 'dining_plans', 'chains', 'stores', 'product_categories', 'products',
    'store_products', 'prices', 'discount_groups', 'promotions', 'food_traits',
    'product_traits', 'profiles', 'user_locations', 'user_stores',
    'discount_eligibilities', 'user_food_rules', 'admin_users', 'groups',
    'group_members', 'lists', 'list_items', 'item_habits', 'shopping_trips',
    'orders', 'order_items', 'order_shares', 'purchases', 'recipes',
    'recipe_ingredients', 'sponsorships', 'push_tokens'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'colleges', 'dining_plans', 'chains', 'stores', 'product_categories', 'products',
    'store_products', 'discount_groups', 'promotions', 'food_traits', 'product_traits'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true);',
      t || '_read', t
    );
    execute format(
      'create policy %1$I on public.%2$I for all to authenticated
         using (public.is_admin()) with check (public.is_admin());',
      t || '_admin_write', t
    );
  end loop;
end $$;

create policy prices_read on public.prices
  for select to authenticated using (true);
create policy prices_insert_report on public.prices
  for insert to authenticated
  with check (public.is_admin() or (source = 'user_report' and submitted_by = auth.uid()));

create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

do $$
declare
  t text;
  tables text[] := array[
    'user_locations', 'user_stores', 'discount_eligibilities',
    'user_food_rules', 'push_tokens'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %1$I on public.%2$I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t || '_owner', t
    );
  end loop;
end $$;

create policy groups_read on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy groups_insert on public.groups
  for insert to authenticated with check (created_by = auth.uid());
create policy groups_update on public.groups
  for update to authenticated
  using (public.is_group_owner(id)) with check (public.is_group_owner(id));

create policy group_members_read on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy group_members_leave on public.group_members
  for delete to authenticated using (user_id = auth.uid());
create policy group_members_owner_update on public.group_members
  for update to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
create policy group_members_owner_delete on public.group_members
  for delete to authenticated using (public.is_group_owner(group_id));

create policy lists_member on public.lists
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy list_items_member on public.list_items
  for all to authenticated
  using (public.is_group_member((select group_id from public.lists where id = list_id)))
  with check (public.is_group_member((select group_id from public.lists where id = list_id)));

create policy item_habits_member on public.item_habits
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy trips_member on public.shopping_trips
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy orders_member on public.orders
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy order_items_member on public.order_items
  for all to authenticated
  using (public.is_group_member((select group_id from public.orders where id = order_id)))
  with check (public.is_group_member((select group_id from public.orders where id = order_id)));

create policy order_shares_read on public.order_shares
  for select to authenticated
  using (public.is_group_member((select group_id from public.orders where id = order_id)));
create policy order_shares_payer_update on public.order_shares
  for update to authenticated
  using (auth.uid() = (select paid_by from public.orders where id = order_id))
  with check (auth.uid() = (select paid_by from public.orders where id = order_id));

create policy purchases_read on public.purchases
  for select to authenticated using (public.is_group_member(group_id));
create policy purchases_insert_payer on public.purchases
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_group_member(group_id) and order_id is null);

create policy recipes_read on public.recipes
  for select to authenticated using (is_public or created_by = auth.uid());
create policy recipes_insert on public.recipes
  for insert to authenticated with check (created_by = auth.uid());
create policy recipes_update on public.recipes
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy recipes_delete on public.recipes
  for delete to authenticated using (created_by = auth.uid());

create policy recipe_ingredients_read on public.recipe_ingredients
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and (r.is_public or r.created_by = auth.uid())
  ));
create policy recipe_ingredients_write on public.recipe_ingredients
  for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = auth.uid()));

create policy sponsorships_read on public.sponsorships
  for select to authenticated using (true);
create policy sponsorships_admin_write on public.sponsorships
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- admin_users has no policy. Authenticated clients cannot read or change it.

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
revoke all on table public.admin_users from anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('public-assets', 'public-assets', true)
on conflict (id) do nothing;

drop policy if exists avatars_select_all on storage.objects;
create policy avatars_select_all on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists public_assets_select_all on storage.objects;
create policy public_assets_select_all on storage.objects
  for select using (bucket_id = 'public-assets');

drop policy if exists public_assets_admin_write on storage.objects;
create policy public_assets_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'public-assets' and public.is_admin())
  with check (bucket_id = 'public-assets' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Starter traits
-- ---------------------------------------------------------------------------

insert into public.food_traits (code, name, kind) values
  ('peanuts', 'Peanuts', 'allergen'),
  ('tree-nuts', 'Tree nuts', 'allergen'),
  ('milk', 'Milk', 'allergen'),
  ('eggs', 'Eggs', 'allergen'),
  ('wheat', 'Wheat', 'allergen'),
  ('soy', 'Soy', 'allergen'),
  ('fish', 'Fish', 'allergen'),
  ('shellfish', 'Shellfish', 'allergen'),
  ('sesame', 'Sesame', 'allergen'),
  ('gluten', 'Gluten', 'allergen'),
  ('red-dye-40', 'Red dye 40', 'chemical'),
  ('vegan', 'Vegan', 'dietary'),
  ('vegetarian', 'Vegetarian', 'dietary'),
  ('gluten-free', 'Gluten-free', 'dietary'),
  ('halal', 'Halal', 'certification'),
  ('kosher', 'Kosher', 'certification'),
  ('organic', 'Organic', 'certification')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Table comments. Read these before querying a table directly.
-- ---------------------------------------------------------------------------

comment on table public.colleges is
  'A campus. logo_path points at the public-assets bucket. style is display-only JSON. latitude and longitude are optional geocodes used for distance, not a PostGIS point.';
comment on table public.dining_plans is
  'A named meal plan offered by one college. It does not store a balance. The amount the student wants to spend is profiles.weekly_budget_cents.';
comment on table public.chains is
  'A grocery brand such as Safeway. Stores and promotions both reference this table so a chain-wide coupon is not matched by spelling.';
comment on table public.stores is
  'One physical store. college_id is set only for a campus store. source and source_ref identify the store in an ingestion feed. is_available is not on this table; availability belongs to store_products.';
comment on table public.product_categories is
  'A comparable shopping unit such as whole milk or eggs, not a dietary filter. base_unit is g, ml, or ct. Child categories point at parent_id. Use food_traits for vegan, allergen, and certification filters.';
comment on table public.products is
  'A store-agnostic packaged product. upc is unique when present. is_active false means the product was recalled or discontinued and must not be recommended; old purchases still point at it. ingredients_text is the package text for display. ingredients_updated_at changes only when that text changes.';
comment on table public.store_products is
  'A product sold at one store. is_available means that store currently sells it. It is independent from products.is_active.';
comment on table public.prices is
  'An append-only shelf-price observation in cents. Read the latest row per store_product from current_prices. Students may insert source user_report for themselves; nobody updates a price row.';
comment on table public.discount_groups is
  'A lookup such as student or military. A promotion can require one of these codes.';
comment on table public.discount_eligibilities is
  'The signed-in user opted into a discount group. This is private and is never shown to other group members.';
comment on table public.promotions is
  'A coupon or sale for one store or one chain. discount_value is a percent for percent_off, cents for amount_off, and ignored for bogo. weekdays use 0 = Sunday. A null product_id applies to the whole basket.';
comment on table public.food_traits is
  'One filterable food fact. kind decides which product relation and user mode are legal. Categories stay separate from traits.';
comment on table public.product_traits is
  'A fact about one product. Ingredients, allergens, and chemicals use contains or may_contain. Dietary traits use suitable. Certifications use certified. No row means unknown, never false.';
comment on table public.user_food_rules is
  'Private rule for the signed-in user. Avoid is the only mode for ingredients, allergens, and chemicals. Require and prefer are the only modes for dietary properties and certifications. Shared planning combines members inside recommend_shopping_plan and does not expose who set a rule.';
comment on table public.profiles is
  'The signed-in user. Created automatically from auth.users. weekly_budget_cents is the grocery target used by the planner. preferred_days uses 0 = Sunday.';
comment on table public.user_locations is
  'An address saved by one user. The default row supplies coordinates when a plan is requested without a live location.';
comment on table public.user_stores is
  'Stores the user prefers. This does not by itself restrict a shopping plan.';
comment on table public.admin_users is
  'Users allowed to edit reference data. There is no client policy. Add rows with the service role so a user cannot promote themselves.';
comment on table public.groups is
  'People who share lists and expenses. kind personal is the private group created at signup. household and event are created with create_group. closed_at set means nobody new can join.';
comment on table public.group_members is
  'Membership. Clients join through join_group and leave through leave_group. The personal group cannot be left.';
comment on table public.lists is
  'A named grocery list owned by one group. Signup creates one default list.';
comment on table public.list_items is
  'Something to buy. Set exactly one of product_id, category_id, or custom_name. amount_base is in the category base unit. source_recipe_id is set when the item came from a recipe. done_at means it is checked off.';
comment on table public.item_habits is
  'How often a group uses a product or a category. It belongs to the group, not to the person who pays. Set exactly one target. usual_amount_base uses the category base unit. add_due_habit_items copies due rows onto the default list.';
comment on table public.shopping_trips is
  'One grocery date for a group. planned_for is that date. fulfillment_method is self_pickup (shop in person), store_pickup (order for pickup), or delivery (ship to delivery_location_id). delivery_location_id is required only for delivery and must be null otherwise. A trip has one orders row per store. Do not copy the date or fulfillment method onto every order.';
comment on table public.orders is
  'The portion of a trip bought at one store. Confirm it with confirm_order before finalize_order. checkout_url is the Instacart link. unit prices live on order_items.';
comment on table public.order_items is
  'A frozen line. unit_price_cents is the estimated cents paid per unit after the promotion chosen while planning. It does not change when the shelf price changes later.';
comment on table public.order_shares is
  'What a member owes the payer after an order is placed. The payer has no row. amount_cents is frozen. The payer marks status paid and settled_via manual when repaid outside the app.';
comment on table public.purchases is
  'An immutable receipt line. user_id is the person who paid, not the person who will eat the food. expires_on is set only when known at purchase. In-store purchases have a null order_id. Placed orders insert these rows automatically.';
comment on table public.recipes is
  'A public imported recipe or a private recipe written by created_by. source_url is unique so the same web recipe is stored once.';
comment on table public.recipe_ingredients is
  'One ingredient line. It points at a category, not a brand or store. raw_text preserves the original line.';
comment on table public.sponsorships is
  'A paid trending placement for exactly one product or recipe. college_id null means every campus. This table does not change organic purchase counts.';
comment on table public.push_tokens is
  'The Expo push address for one device. It does not store notification messages. Upsert the token when the app launches.';

comment on function public.handle_new_user() is
  'After a Supabase Auth signup, creates the profile, a personal group, owner membership, and a default list. Do not insert those rows from the client.';
comment on function public.is_group_member(uuid) is
  'True when auth.uid() belongs to the group. Policies use this so membership checks do not recurse through row level security.';
comment on function public.is_group_owner(uuid) is
  'True when auth.uid() is an owner of the group.';
comment on function public.is_admin() is
  'True when auth.uid() is in admin_users. Reference-data policies use this.';
comment on function public.place_order_snapshot() is
  'When an order status becomes ordered, writes immutable purchases for the payer and even expense shares for the other members. The payer absorbs leftover cents.';
