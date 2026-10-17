-- Remove objects left by the unrecovered remote-only price_sources migration
-- (20261017220000). Canonical schema lives in the local migration files.

drop function if exists public.nearby_product(double precision, double precision, double precision, text);
drop function if exists public.nearby_shops(double precision, double precision, double precision);
drop function if exists public.list_reportable_stores();
drop function if exists public.register_reportable_store(
  text, text, text, text, text, text, text, double precision, double precision
);
drop function if exists public.report_manual_price(uuid, text, integer, text, text);

drop table if exists public.inventory cascade;
drop table if exists public.product cascade;
drop table if exists public.shops cascade;

-- Baseline stores lat/lng as doubles and does not use PostGIS.
drop extension if exists postgis cascade;
