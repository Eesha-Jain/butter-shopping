-- Allow unauthenticated (guest) clients to read catalog / reference data.
-- Writes and user/group/order tables stay authenticated-only.

do $$
declare
  t text;
  tables text[] := array[
    'colleges',
    'dining_plans',
    'chains',
    'stores',
    'product_categories',
    'products',
    'store_products',
    'discount_groups',
    'promotions',
    'food_traits',
    'product_traits'
  ];
begin
  foreach t in array tables loop
    execute format(
      'drop policy if exists %I on public.%I;',
      t || '_anon_read',
      t
    );
    execute format(
      'create policy %I on public.%I for select to anon using (true);',
      t || '_anon_read',
      t
    );
  end loop;
end $$;

drop policy if exists prices_anon_read on public.prices;
create policy prices_anon_read on public.prices
  for select to anon using (true);

-- Nearby shops RPC is security invoker and only reads stores; guests use Nearby.
revoke all on function public.nearby_shops(double precision, double precision, numeric) from public;
grant execute on function public.nearby_shops(double precision, double precision, numeric) to anon, authenticated;
