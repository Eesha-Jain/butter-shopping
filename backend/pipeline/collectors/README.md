# Offer Collect adapters

Every price or promotion enters Butter through the same pipeline:

1. **Collect** — adapter fetches retailer data or accepts a user submission
2. **Normalize** — map into `shelfOffer` or `promotionOffer` ([`../envelope.js`](../envelope.js))
3. **Validate → Match → write** — [`../ingest.js`](../ingest.js) (`ingestShelf` / `ingestPromotion`)

Do not call Supabase REST from a new adapter. Emit an envelope and call ingest.

## Current Collect sources

| Source | Adapter | Envelope | Notes |
| --- | --- | --- | --- |
| Kroger API (QFC, Fred Meyer) | [`../../qfc.js`](../../qfc.js) via [`../../server.js`](../../server.js) | `shelf` `source: api` | Official product API |
| Safeway XAPI | [`../../safeway.js`](../../safeway.js) | `shelf` `source: scrape` | Public storefront XAPI |
| Trader Joe's GraphQL | [`../../traderjoes.js`](../../traderjoes.js) | `shelf` `source: scrape` | Public site GraphQL |
| WA discount policies | [`../../wa-discounts.json`](../../wa-discounts.json) via [`../../import-wa-snap.js`](../../import-wa-snap.js) | `promotion` | Senior/student day policies |
| Manual shelf report | `report_manual_price` RPC | `user_report` (SQL path) | Trusted authority over api/scrape |

## Adding a weekly-ad scraper

1. Fetch the ad for one store or chain.
2. For each deal, build `promotionOffer({ chainName, discountType, discountValue, startsAt, endsAt, weekdays?, productUpc?, externalRef })`.
3. Call `ingestPromotion(envelope)`.
4. Prefer a stable `externalRef` (e.g. `weekly-ad:safeway:2026-10-15:sku`) so re-runs upsert.

Shelf observations (temporary sale price on a product) use `shelfOffer` with `promoPriceCents` / `regularPriceCents`, not a promotion row, unless the deal is calendar- or eligibility-based.

## Match for the app

`price_options` (and `recommend_shopping_plan`) join **trusted** shelf prices with applicable promotions and compute estimated savings. Client `searchShelfPrices` / `mergeOffers` apply the same trust rule live.

## Stability priority

Do not invent a second truth path. When Collecting:

1. **Identity** — UPC, else name+brand.
2. **Trusted price** — skip appending `api`/`scrape` when a non-stale `user_report` exists for that listing (`refreshPriority.shouldAppendAutomatedPrice`).
3. **Freshness** — refresh stale automated prices; leave manual until a newer report.
4. **Completeness** — only PATCH null product fields (`upc`, brand, size). See `product_price_health` for scores.
5. **Promotions** — weekly ads / policies via `promotionOffer` only; they never replace shelf cents.
