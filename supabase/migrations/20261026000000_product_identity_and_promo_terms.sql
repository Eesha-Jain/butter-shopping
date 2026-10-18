-- Product cross-store identity + richer BOGO terms + shelf regular on trusted prices.

-- ---------------------------------------------------------------------------
-- products: canonical UPC, fingerprint, display name
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists canonical_upc text,
  add column if not exists fingerprint text,
  add column if not exists display_name text;

comment on column public.products.canonical_upc is
  'GTIN-14 digits (leading zeros). Unique when set so padded UPC variants collapse.';
comment on column public.products.fingerprint is
  'brand|normalized_name|size_amount|size_unit for soft match when UPC is missing.';
comment on column public.products.display_name is
  'Short card title derived from retailer name (marketing fluff stripped).';

update public.products
set canonical_upc = lpad(
  nullif(regexp_replace(regexp_replace(upc, '\D', '', 'g'), '^0+', ''), ''),
  14,
  '0'
)
where upc is not null
  and length(regexp_replace(upc, '\D', '', 'g')) between 8 and 14
  and canonical_upc is null;

-- Fix empty-string edge from all-zero barcodes
update public.products
set canonical_upc = null
where canonical_upc is not null and trim(canonical_upc) = '';

update public.products
set display_name = name
where display_name is null and name is not null;

update public.products
set fingerprint = lower(trim(brand))
  || '|' || trim(both from regexp_replace(lower(trim(name)), '[^a-z0-9\s]', '', 'g'))
  || '|' || size_base_amount::text
  || '|' || size_base_unit
where fingerprint is null
  and brand is not null and trim(brand) <> ''
  and size_base_amount is not null and size_base_amount > 0
  and size_base_unit is not null;

-- Merge duplicate products that share canonical_upc (keep richest survivor) before unique index.
do $$
declare
  r record;
  survivor uuid;
  loser uuid;
begin
  for r in
    select canonical_upc, array_agg(id order by
      (case when image_path is not null then 0 else 1 end),
      (case when brand is not null then 0 else 1 end),
      (case when size_base_amount is not null then 0 else 1 end),
      created_at
    ) as ids
    from public.products
    where canonical_upc is not null and is_active
    group by canonical_upc
    having count(*) > 1
  loop
    survivor := r.ids[1];
    foreach loser in array r.ids[2:] loop
      update public.store_products sp
      set product_id = survivor
      where sp.product_id = loser
        and not exists (
          select 1 from public.store_products keep
          where keep.store_id = sp.store_id and keep.product_id = survivor
        );

      delete from public.store_products where product_id = loser;

      update public.promotions set product_id = survivor where product_id = loser;

      if to_regclass('public.product_favorites') is not null then
        update public.product_favorites pf
        set product_id = survivor
        where pf.product_id = loser
          and not exists (
            select 1 from public.product_favorites f
            where f.user_id = pf.user_id and f.product_id = survivor
          );
        delete from public.product_favorites where product_id = loser;
      end if;

      update public.products set is_active = false, updated_at = now() where id = loser;
    end loop;
  end loop;
end $$;

create unique index if not exists products_canonical_upc_key
  on public.products (canonical_upc)
  where canonical_upc is not null;

create index if not exists products_fingerprint_idx
  on public.products (fingerprint)
  where fingerprint is not null and is_active;

-- ---------------------------------------------------------------------------
-- promotions: buy X get Y + optional label
-- ---------------------------------------------------------------------------

alter table public.promotions
  add column if not exists buy_quantity integer,
  add column if not exists get_quantity integer,
  add column if not exists label text;

alter table public.promotions
  drop constraint if exists promotions_buy_get_check;

alter table public.promotions
  add constraint promotions_buy_get_check
  check (
    (buy_quantity is null and get_quantity is null)
    or (
      buy_quantity is not null and get_quantity is not null
      and buy_quantity >= 1 and get_quantity >= 1
      and buy_quantity <= 50 and get_quantity <= 50
    )
  );

comment on column public.promotions.buy_quantity is
  'Units that must be paid for in a BOGO cycle (e.g. 3 for buy-3-get-1). Null means classic 1.';
comment on column public.promotions.get_quantity is
  'Free units per BOGO cycle. Null means classic 1.';
comment on column public.promotions.label is
  'Optional short terms override for the shop badge.';

update public.promotions
set buy_quantity = 1, get_quantity = 1
where discount_type = 'bogo' and buy_quantity is null;

drop function if exists public.discounted_line_cents(integer, numeric, text, numeric);

create function public.discounted_line_cents(
  p_unit_price_cents integer,
  p_quantity numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_buy_quantity integer default 1,
  p_get_quantity integer default 1
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
      greatest(
        0,
        round(
          p_unit_price_cents * (
            p_quantity
            - floor(p_quantity / greatest(coalesce(p_buy_quantity, 1) + coalesce(p_get_quantity, 1), 1))
              * coalesce(p_get_quantity, 1)
          )
        )
      )::int
    else round(p_unit_price_cents * p_quantity)::int
  end;
$$;

comment on function public.discounted_line_cents(integer, numeric, text, numeric, integer, integer) is
  'Line total in cents. bogo charges for buy_quantity units per buy+get cycle (defaults 1+1).';

grant execute on function public.discounted_line_cents(integer, numeric, text, numeric, integer, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- trusted_current_prices: expose regular for shelf-sale badges
-- ---------------------------------------------------------------------------

create or replace view public.trusted_current_prices
with (security_invoker = true) as
select distinct on (store_product_id)
  store_product_id,
  price_cents,
  regular_price_cents,
  source,
  created_at,
  (now() - created_at) > interval '24 hours' as is_stale
from public.prices
order by
  store_product_id,
  case when source = 'user_report' then 0 else 1 end,
  created_at desc;

comment on view public.trusted_current_prices is
  'Trusted shelf price per listing: latest user_report wins. Includes regular_price_cents for sale badges.';

grant select on public.trusted_current_prices to authenticated, anon;
