-- Test-only sponsored placements so the Trending strip shows "Sponsored" cards.
-- Re-runnable: skips products that already have an active sponsorship.
-- Run: npx supabase db query --linked -f scripts/seed-sponsored.sql
-- Remove: delete from public.sponsorships where starts_at = '2026-10-18 00:00:00+00';

with picks as (
  select distinct on (p.category_id) p.id
  from public.products p
  join public.store_products sp on sp.product_id = p.id and sp.is_available
  join public.trusted_current_prices t on t.store_product_id = sp.id
  where p.is_active
    and p.image_path is not null
    and not exists (
      select 1 from public.sponsorships s
      where s.product_id = p.id and s.ends_at > now()
    )
  order by p.category_id, p.created_at desc
)
insert into public.sponsorships (product_id, college_id, starts_at, ends_at)
select id, null, '2026-10-18 00:00:00+00'::timestamptz, '2026-11-18 00:00:00+00'::timestamptz
from picks
order by random()
limit 4
returning product_id;
