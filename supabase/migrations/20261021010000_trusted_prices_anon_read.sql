-- Guests browse PDP/shop cheapest via trusted_current_prices (user_report preferred).
-- Matches current_prices anon access from 20261018010000_anon_catalog_read.

grant select on public.trusted_current_prices to anon;
