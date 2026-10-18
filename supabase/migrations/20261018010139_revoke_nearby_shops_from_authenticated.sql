-- Allow signed-out clients (PostgREST role anon) to find shops by GPS.
-- Keep authenticated so the same RPC still works after sign-in.
-- SECURITY INVOKER also needs SELECT on stores and EXECUTE on distance_km.

revoke all on function public.nearby_shops(double precision, double precision, numeric)
  from public;

grant execute on function public.nearby_shops(double precision, double precision, numeric)
  to anon, authenticated, service_role;

grant execute on function public.distance_km(
  double precision, double precision, double precision, double precision
) to anon;

drop policy if exists stores_read_anon on public.stores;
create policy stores_read_anon on public.stores
  for select
  to anon
  using (true);

comment on function public.nearby_shops(double precision, double precision, numeric) is
  'Stores within p_radius_km of a latitude/longitude, nearest first. Stores without coordinates are omitted. Callable by anon and authenticated.';
