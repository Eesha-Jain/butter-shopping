-- Rename nearby_stores to nearby_shops. Signature and result columns stay the same.

drop function if exists public.nearby_stores(double precision, double precision, numeric);

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
  distance_km numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id, s.name, s.chain_id, s.college_id, s.address_line1, s.city, s.region,
    s.postal_code, s.latitude, s.longitude,
    public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) as distance_km
  from public.stores s
  where s.latitude is not null
    and s.longitude is not null
    and public.distance_km(p_latitude, p_longitude, s.latitude, s.longitude) <= p_radius_km
  order by distance_km;
$$;

comment on function public.nearby_shops(double precision, double precision, numeric) is
  'Stores within p_radius_km of a latitude/longitude, nearest first. Stores without coordinates are omitted. Pass the device location or the user''s default saved address.';

revoke all on function public.nearby_shops(double precision, double precision, numeric) from public;
grant execute on function public.nearby_shops(double precision, double precision, numeric) to authenticated;
