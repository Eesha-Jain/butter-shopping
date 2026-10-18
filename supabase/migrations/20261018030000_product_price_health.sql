-- Completeness + trust signal per store listing for Collect refresh priority.

create or replace view public.product_price_health
with (security_invoker = true) as
select
  sp.id as store_product_id,
  sp.store_id,
  sp.product_id,
  (p.upc is not null) as has_upc,
  (
    p.size_base_amount is not null
    and p.size_base_amount > 0
    and p.size_base_unit is not null
  ) as has_size,
  (tcp.store_product_id is not null) as has_trusted_price,
  tcp.source as price_source,
  coalesce(tcp.is_stale, true) as is_stale,
  (
    case when tcp.store_product_id is not null then 40 else 0 end
    + case when tcp.store_product_id is not null and not tcp.is_stale then 25 else 0 end
    + case when p.upc is not null then 20 else 0 end
    + case
        when p.size_base_amount is not null
          and p.size_base_amount > 0
          and p.size_base_unit is not null
        then 15
        else 0
      end
  )::int as completeness_score
from public.store_products sp
join public.products p on p.id = sp.product_id
left join public.trusted_current_prices tcp on tcp.store_product_id = sp.id;

comment on view public.product_price_health is
  'Per-listing completeness: trusted price (40), fresh (25), upc (20), size (15). Used to prioritize Collect refresh without overriding manual prices.';

grant select on public.product_price_health to authenticated;
