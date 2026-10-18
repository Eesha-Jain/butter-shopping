-- SNAP / EBT as an onboarding demographic opt-in, plus store + category flags for UI badges.

insert into public.discount_groups (code, name)
values ('snap', 'SNAP / EBT')
on conflict (code) do update
set name = excluded.name;

alter table public.product_categories
  add column if not exists snap_eligible boolean not null default true;

comment on column public.product_categories.snap_eligible is
  'True when typical items in this category can be bought with SNAP/EBT. Hot prepared food and non-food land in Other (false).';

update public.product_categories
set snap_eligible = false
where lower(name) = 'other';

create or replace function public.nearby_shops(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km numeric default 25
)
returns table (
  id uuid,
  name text,
  chain_id uuid,
  college_id uuid,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  distance_km numeric,
  accepts_snap boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id, s.name, s.chain_id, s.college_id, s.address_line1, s.city, s.region,
    s.postal_code, s.latitude, s.longitude,
    public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) as distance_km,
    s.accepts_snap
  from public.stores s
  where s.latitude is not null
    and s.longitude is not null
    and public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) <= p_radius_km
    and exists (
      select 1
      from public.store_products sp
      join public.products prod on prod.id = sp.product_id
      where sp.store_id = s.id
        and sp.is_available
        and prod.is_active
        and exists (
          select 1
          from public.prices p
          where p.store_product_id = sp.id
            and p.price_cents > 0
        )
    )
  order by distance_km;
$$;

comment on function public.nearby_shops(double precision, double precision, numeric) is
  'Stores within p_radius_km that have at least one available, active product with a shelf price. Nearest first. Includes accepts_snap for SNAP badge UI. Stores without coordinates are omitted.';

revoke all on function public.nearby_shops(double precision, double precision, numeric) from public;
grant execute on function public.nearby_shops(double precision, double precision, numeric)
  to anon, authenticated, service_role;
