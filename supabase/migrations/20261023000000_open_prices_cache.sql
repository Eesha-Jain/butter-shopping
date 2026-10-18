-- Daily cache of Open Prices (Open Food Facts) lookups by barcode + coarse geo.
-- Crowdsourced shelf prices; used only to fill gaps when retailer prices are missing.

create table public.open_prices_cache (
  upc text not null,
  geo_key text not null default 'global',
  price_day date not null,
  -- null means we looked up and found no usable USD/nearby price (negative cache).
  price_cents integer,
  currency text,
  store_name text,
  city text,
  country text,
  observed_date date,
  fetched_at timestamptz not null default now(),
  primary key (upc, geo_key, price_day),
  constraint open_prices_cache_upc_digits check (upc ~ '^\d{8,14}$'),
  constraint open_prices_cache_price_cents_positive check (
    price_cents is null or price_cents > 0
  )
);

comment on table public.open_prices_cache is
  'Cached Open Prices lookups keyed by barcode, coarse geo cell, and local day.';

create index open_prices_cache_day_idx
  on public.open_prices_cache (price_day desc);

alter table public.open_prices_cache enable row level security;

-- Public crowd-sourced cache: anyone may read or refresh for the day.
create policy open_prices_cache_select
  on public.open_prices_cache
  for select
  to anon, authenticated
  using (true);

create policy open_prices_cache_insert
  on public.open_prices_cache
  for insert
  to anon, authenticated
  with check (true);

create policy open_prices_cache_update
  on public.open_prices_cache
  for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.open_prices_cache to anon, authenticated;
grant select, insert, update, delete on public.open_prices_cache to service_role;
