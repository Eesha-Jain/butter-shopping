-- Student shelf photo evidence on price reports, plus mark in/out of stock.

alter table public.prices
  add column if not exists evidence_path text;

comment on column public.prices.evidence_path is
  'Optional Storage path in the price-evidence bucket (user_id/…). Shelf tag photo for a user_report.';

-- Public bucket so the app can show evidence via getPublicUrl (like avatars).
insert into storage.buckets (id, name, public)
values ('price-evidence', 'price-evidence', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists price_evidence_select_all on storage.objects;
create policy price_evidence_select_all on storage.objects
  for select
  using (bucket_id = 'price-evidence');

drop policy if exists price_evidence_insert_own on storage.objects;
create policy price_evidence_insert_own on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'price-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists price_evidence_update_own on storage.objects;
create policy price_evidence_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'price-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'price-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists price_evidence_delete_own on storage.objects;
create policy price_evidence_delete_own on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'price-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop function if exists public.report_manual_price(uuid, text, integer, text, text);

create or replace function public.report_manual_price(
  p_store_id uuid,
  p_product_name text,
  p_price_cents integer,
  p_brand text default null,
  p_upc text default null,
  p_evidence_path text default null
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
  v_evidence text := nullif(btrim(coalesce(p_evidence_path, '')), '');
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

  if v_evidence is not null then
    if position('/' in v_evidence) = 0
       or split_part(v_evidence, '/', 1) <> auth.uid()::text then
      raise exception 'Evidence photo must be stored under your user folder.';
    end if;
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

  -- Seeing a shelf price means the item is in stock at that store.
  insert into public.store_products (store_id, product_id, is_available)
  values (p_store_id, v_product_id, true)
  on conflict (store_id, product_id) do update set
    is_available = true,
    updated_at = now()
  returning id into v_store_product_id;

  insert into public.prices (store_product_id, price_cents, source, submitted_by, evidence_path)
  values (v_store_product_id, p_price_cents, 'user_report', auth.uid(), v_evidence)
  returning id into v_price_id;

  return v_price_id;
end;
$$;

comment on function public.report_manual_price(uuid, text, integer, text, text, text) is
  'Appends a user_report price for any store. Optional evidence_path is a price-evidence Storage object under the caller uid. Creates the product and store listing when missing. Marks the listing available.';

revoke all on function public.report_manual_price(uuid, text, integer, text, text, text) from public;
grant execute on function public.report_manual_price(uuid, text, integer, text, text, text) to authenticated;

create or replace function public.report_store_product_availability(
  p_store_product_id uuid,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before updating stock status.';
  end if;
  if p_store_product_id is null then
    raise exception 'A store listing is required.';
  end if;
  if p_is_available is null then
    raise exception 'Availability is required.';
  end if;

  update public.store_products
  set
    is_available = p_is_available,
    updated_at = now()
  where id = p_store_product_id;

  if not found then
    raise exception 'Store listing not found.';
  end if;
end;
$$;

comment on function public.report_store_product_availability(uuid, boolean) is
  'Lets a signed-in student mark a store listing in or out of stock.';

revoke all on function public.report_store_product_availability(uuid, boolean) from public;
grant execute on function public.report_store_product_availability(uuid, boolean) to authenticated;
