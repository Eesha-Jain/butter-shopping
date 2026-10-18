-- Allow guests (anon) to browse the public catalog. Writes stay authenticated/admin-only.

grant select on public.product_categories, public.products, public.product_traits,
  public.food_traits, public.promotions, public.store_products, public.prices,
  public.current_prices, public.v_trending
to anon;

do $$
declare
  t text;
  tables text[] := array[
    'product_categories', 'products', 'product_traits', 'food_traits', 'promotions',
    'store_products', 'prices'
  ];
begin
  foreach t in array tables loop
    execute format(
      'drop policy if exists %I on public.%I;
       create policy %I on public.%I for select to anon using (true);',
      t || '_anon_read', t, t || '_anon_read', t
    );
  end loop;
end $$;
