-- Price sources: QFC and Safeway rows are written by the server.
-- Signed-in users may report shelf prices only at Trader Joe's and campus stores.

insert into public.chains (name)
values ('QFC'), ('Trader Joe''s'), ('Safeway')
on conflict do nothing;

create or replace function public.list_reportable_stores()
returns table (
  id uuid,
  name text,
  chain_name text,
  college_id uuid,
  college_name text,
  address_line1 text,
  city text,
  region text,
  postal_code text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    s.name,
    c.name,
    s.college_id,
    col.name,
    s.address_line1,
    s.city,
    s.region,
    s.postal_code
  from public.stores s
  left join public.chains c on c.id = s.chain_id
  left join public.colleges col on col.id = s.college_id
  where s.college_id is not null
     or lower(c.name) = 'trader joe''s'
  order by s.name;
$$;

comment on function public.list_reportable_stores() is
  'Stores where a signed-in user may report a shelf price: Trader Joe''s, and any store attached to a college.';

create or replace function public.register_reportable_store(
  p_name text,
  p_kind text,
  p_college_name text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_region text default null,
  p_postal_code text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(p_name);
  v_chain_id uuid;
  v_college_id uuid;
  v_store_id uuid;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before adding a store.';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'A store name is required.';
  end if;
  if p_kind not in ('trader_joes', 'campus') then
    raise exception 'Reportable stores are Trader Joe''s or campus stores.';
  end if;
  if p_latitude is not null and p_latitude not between -90 and 90 then
    raise exception 'Latitude is out of range.';
  end if;
  if p_longitude is not null and p_longitude not between -180 and 180 then
    raise exception 'Longitude is out of range.';
  end if;

  if p_kind = 'trader_joes' then
    select id into v_chain_id from public.chains where lower(name) = 'trader joe''s';
    if v_chain_id is null then
      raise exception 'Trader Joe''s is not in the chain list.';
    end if;
  else
    if p_college_name is null or length(btrim(p_college_name)) = 0 then
      raise exception 'A campus store needs a college name.';
    end if;
    select id into v_college_id
    from public.colleges
    where lower(name) = lower(btrim(p_college_name))
    limit 1;
    if v_college_id is null then
      insert into public.colleges (name)
      values (btrim(p_college_name))
      returning id into v_college_id;
    end if;
  end if;

  v_ref := 'user:' || md5(
    lower(p_kind) || '|' || lower(v_name) || '|' || lower(coalesce(btrim(p_postal_code), ''))
  );

  insert into public.stores (
    name, chain_id, college_id, address_line1, city, region, postal_code,
    latitude, longitude, source, source_ref
  )
  values (
    v_name,
    v_chain_id,
    v_college_id,
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_region, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    p_latitude,
    p_longitude,
    'user_report',
    v_ref
  )
  on conflict (source, source_ref) do update
    set name = excluded.name,
        address_line1 = excluded.address_line1,
        city = excluded.city,
        region = excluded.region,
        postal_code = excluded.postal_code,
        latitude = excluded.latitude,
        longitude = excluded.longitude
  returning id into v_store_id;

  return v_store_id;
end;
$$;

comment on function public.register_reportable_store(text, text, text, text, text, text, text, double precision, double precision) is
  'Creates or updates a Trader Joe''s or campus store the caller can report prices for. The same name and postal code return the same store.';

create or replace function public.report_manual_price(
  p_store_id uuid,
  p_product_name text,
  p_price_cents integer,
  p_brand text default null,
  p_upc text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain text;
  v_college uuid;
  v_name text := btrim(p_product_name);
  v_brand text := nullif(btrim(coalesce(p_brand, '')), '');
  v_upc text := nullif(btrim(coalesce(p_upc, '')), '');
  v_product_id uuid;
  v_store_product_id uuid;
  v_price_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before reporting a price.';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'A product name is required.';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'Price must be zero or more cents.';
  end if;

  select c.name, s.college_id into v_chain, v_college
  from public.stores s
  left join public.chains c on c.id = s.chain_id
  where s.id = p_store_id;

  if not found then
    raise exception 'Store not found.';
  end if;
  if v_college is null and lower(coalesce(v_chain, '')) <> 'trader joe''s' then
    raise exception 'Shelf prices can be reported only for Trader Joe''s and campus stores.';
  end if;

  if v_upc is not null then
    select id into v_product_id from public.products where upc = v_upc;
  end if;
  if v_product_id is null then
    select id into v_product_id
    from public.products
    where lower(name) = lower(v_name)
      and lower(coalesce(brand, '')) = lower(coalesce(v_brand, ''))
      and (v_upc is null or upc is null)
    limit 1;
  end if;

  if v_product_id is null then
    begin
      insert into public.products (name, brand, upc)
      values (v_name, v_brand, v_upc)
      returning id into v_product_id;
    exception
      when unique_violation then
        select id into v_product_id from public.products where upc = v_upc;
    end;
  end if;

  insert into public.store_products (store_id, product_id, is_available)
  values (p_store_id, v_product_id, true)
  on conflict (store_id, product_id) do update set is_available = true
  returning id into v_store_product_id;

  insert into public.prices (store_product_id, price_cents, source, submitted_by)
  values (v_store_product_id, p_price_cents, 'user_report', auth.uid())
  returning id into v_price_id;

  return v_price_id;
end;
$$;

comment on function public.report_manual_price(uuid, text, integer, text, text) is
  'Appends a user_report price for a Trader Joe''s or campus store. Creates the product and store listing when they are missing. Prices are never updated.';

revoke all on function public.list_reportable_stores() from public;
revoke all on function public.register_reportable_store(text, text, text, text, text, text, text, double precision, double precision) from public;
revoke all on function public.report_manual_price(uuid, text, integer, text, text) from public;

grant execute on function public.list_reportable_stores() to authenticated;
grant execute on function public.register_reportable_store(text, text, text, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.report_manual_price(uuid, text, integer, text, text) to authenticated;
