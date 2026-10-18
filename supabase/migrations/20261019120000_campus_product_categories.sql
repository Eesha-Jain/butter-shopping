-- Top-level Shop category chips for campus catalog browse.
-- Products get category_id assigned by bootstrap keyword mapping after ingest.

insert into public.product_categories (name, parent_id, base_unit, typical_shelf_life_days)
select v.name, null, v.base_unit, v.shelf_life
from (
  values
    ('Produce', 'ct', 7),
    ('Dairy', 'ml', 14),
    ('Meat & Seafood', 'g', 4),
    ('Pantry', 'g', null::integer),
    ('Snacks', 'g', null::integer),
    ('Beverages', 'ml', null::integer),
    ('Frozen', 'g', 90),
    ('Bakery', 'ct', 5)
) as v(name, base_unit, shelf_life)
where not exists (
  select 1 from public.product_categories c where lower(c.name) = lower(v.name)
);
