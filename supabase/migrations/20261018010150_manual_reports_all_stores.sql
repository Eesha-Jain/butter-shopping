-- Manual shelf reports are allowed at every store. Automated api/scrape prices
-- remain available; user_report is the trusted authority when both exist.
-- Also seed WA priority chains used by the price proxy and discount importer.

insert into public.chains (name)
values
  ('Fred Meyer'),
  ('Whole Foods Market'),
  ('Uwajimaya')
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
  order by s.name;
$$;

comment on function public.list_reportable_stores() is
  'Every store a signed-in user may attach a shelf-price report to.';

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

  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception 'Store not found.';
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
  'Appends a user_report price for any store. Creates the product and store listing when they are missing. Prices are never updated. Manual reports are the trusted authority over api and scrape observations.';

revoke all on function public.list_reportable_stores() from public;
revoke all on function public.report_manual_price(uuid, text, integer, text, text) from public;

grant execute on function public.list_reportable_stores() to authenticated;
grant execute on function public.report_manual_price(uuid, text, integer, text, text) to authenticated;
