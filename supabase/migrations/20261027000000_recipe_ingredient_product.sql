-- Parsed recipe lines point at a catalog product so they can be ordered.

alter table public.recipe_ingredients
  add column if not exists product_id uuid references public.products (id) on delete set null;

comment on column public.recipe_ingredients.product_id is
  'Catalog product this ingredient should be ordered as. Null when no name match.';

create index if not exists recipe_ingredients_product_idx
  on public.recipe_ingredients (product_id);
