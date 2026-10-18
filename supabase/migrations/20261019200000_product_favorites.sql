-- Per-user product favorites for Shop filter and heart toggles.

create table public.product_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index product_favorites_product_idx on public.product_favorites (product_id);

comment on table public.product_favorites is
  'Products the signed-in user marked as favorites. Guests keep favorites on-device until merge.';

alter table public.product_favorites enable row level security;

create policy product_favorites_owner on public.product_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.product_favorites to authenticated;
grant select, insert, update, delete on public.product_favorites to service_role;
