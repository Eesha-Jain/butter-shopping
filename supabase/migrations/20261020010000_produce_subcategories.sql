-- Fruits / Vegetables under Produce, plus category_source for OFF vs keyword.

alter table public.products
  add column if not exists category_source text
    check (category_source is null or category_source in ('off', 'keyword', 'manual'));

comment on column public.products.category_source is
  'How category_id was set: off (Open Food Facts), keyword (name map), or manual. OFF may overwrite keyword; never overwrite manual.';

insert into public.product_categories (name, parent_id, base_unit, typical_shelf_life_days)
select v.name, p.id, 'ct', 7
from public.product_categories p
cross join (
  values
    ('Fruits'),
    ('Vegetables')
) as v(name)
where lower(p.name) = 'produce'
  and p.parent_id is null
  and not exists (
    select 1 from public.product_categories c where lower(c.name) = lower(v.name)
  );
