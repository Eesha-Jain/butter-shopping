-- Non-food / unmatched catalog items land in Other (hidden from default Shop browse).

insert into public.product_categories (name, parent_id, base_unit, typical_shelf_life_days)
select 'Other', null, 'ct', null::integer
where not exists (
  select 1 from public.product_categories c where lower(c.name) = 'other'
);
