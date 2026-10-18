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
| Weekly ads (JSON) | [`weekly-ad.js`](weekly-ad.js) + [`../../import-weekly-ads.js`](../../import-weekly-ads.js) | `promotion` | Product-scoped circular deals; sample [`../../weekly-ads.sample.json`](../../weekly-ads.sample.json) |
| Manual shelf report | `report_manual_price` RPC | `user_report` (SQL path) | Trusted authority over api/scrape |

## Per-store rule

Card cash back (the shopper's grocery rate and Visa merchant offers) is not a store coupon. Do not add a collector for it here.

- Trader Joe's contributes a shelf price only. Do not import the Fearless Flyer as a promotion, and do not invent a loyalty or coupon row. `promoPriceCents` stays null.
- QFC and Fred Meyer sale prices come from the Kroger Products API for a specific store (`locationId`, client-credentials `product.compact`). That is regular versus promo shelf cents, not a clipped coupon. Do not add Kroger account login or coupon clipping.
- Safeway sale prices come from the public product feed. Do not scrape Just for U or any logged-in coupon page.
- A weekly-ad promotion is allowed only when the deal list is already supplied (the existing JSON import). `import-weekly-ads.js` refuses a file whose chain is Trader Joe's.

## Adding a weekly-ad import

1. Start from a JSON file that already lists the deals (`chainName`, `startsAt`, `endsAt`, `deals`). Do not add a circular scraper here.
2. Map rows into deal objects and call `weeklyAdPromotionOffers({ chainName, startsAt, endsAt, deals })`.
3. For each envelope, `ingestPromotion(envelope)` (or run `node import-weekly-ads.js ads.json`).
4. Prefer a stable `externalRef` (e.g. `weekly-ad:safeway:2026-10-15:sku`) so re-runs upsert.
5. Set `productUpc` whenever possible so the deal attaches to a catalog product and shows on cards.
6. For buy-X-get-Y, use `discountType: 'bogo'` with `buyQuantity` / `getQuantity` (e.g. 3 and 1).

Shelf observations (temporary sale price on a product) use `shelfOffer` with `promoPriceCents` / `regularPriceCents`, not a promotion row, unless the deal is calendar- or eligibility-based. Card badges also fall back to regular vs sale shelf deltas when no promotion row exists.

## Match for the app

`price_options` (and `recommend_shopping_plan`) join **trusted** shelf prices with applicable promotions and compute estimated savings. Client `searchShelfPrices` / `mergeOffers` apply the same trust rule live.

## Stability priority

Do not invent a second truth path. When Collecting:

1. **Identity** — UPC, else name+brand.
2. **Trusted price** — skip appending `api`/`scrape` when a non-stale `user_report` exists for that listing (`refreshPriority.shouldAppendAutomatedPrice`).
3. **Freshness** — refresh stale automated prices; leave manual until a newer report.
4. **Completeness** — only PATCH null product fields (`upc`, brand, size). See `product_price_health` for scores.
5. **Promotions** — weekly ads / policies via `promotionOffer` only; they never replace shelf cents.
