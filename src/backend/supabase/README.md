# Supabase data layer

Screens should import from `@/backend` (or `@/backend/types` for types only).
Do not call the raw Supabase client from UI code.

Shared domain types live in [`../types`](../types). The client and domain
helpers live in this folder. SQL migrations live in the repo-root
[`supabase/migrations`](../../../supabase/migrations) directory.

The comments above each function say which records it uses and which rule the
caller has to follow.

## Error handling and toasts

Failed Auth, queries, RPCs, and Edge Function calls show a Burnt error toast
and throw `AppError`. The toast runs once; `AppError.toasted` prevents
duplicates if a screen also catches the error.

```ts
import { createTripFromList, runAction, showSuccessToast } from '@/backend';

await runAction(async () => {
  const tripId = await createTripFromList({ listId, plannedFor, fulfillmentMethod: 'self_pickup' });
  showSuccessToast('Trip ready', 'Confirm each store order when you are set.');
  return tripId;
}, 'Could not create that shopping trip.');
```

`runAction` is optional when you already `await` a helper: those helpers toast
on their own. Use it when you want a custom fallback message around several calls.

## Google sign-in and Auth redirect URLs

In the Supabase Dashboard → **Authentication → URL Configuration → Additional
Redirect URLs**, keep both:

- `exp://**` — Expo Go (iOS usually works; Android Custom Tabs handoff is flaky)
- `buttershopping://**` — development builds and store builds

`signInWithGoogle` uses `makeRedirectUri({ scheme: 'buttershopping', path: 'auth/callback' })`.
Expo Go remaps that to `exp://…`; a development build uses
`buttershopping://auth/callback`.

### Android team workflow (install once, hot-reload daily)

Google login on Android is reliable in a **development build**, not Expo Go.

1. One person builds and shares an APK: `npm run build:dev:android`
   (uses `npx eas-cli@latest`; or `npx expo run:android` locally).
2. Teammates install that APK once, then daily: `npm run start:dev` and open the
   Butter app (not Expo Go). JS hot-reloads; rebuild only when native config or
   native libraries change.
3. Email/password on the auth screen works everywhere, including Android Expo Go,
   when you only need a quick test account.

## How the data fits together

A person signs up through Supabase Auth. A database trigger creates a profile,
a private group named "My Groceries," owner membership, and a default grocery
list. A solo shopper is a group of one. A household or a party is another group,
created with `createGroup` and joined with an invite code.

A list belongs to a group. Each list item is exactly one of a specific product,
a shopping category such as "whole milk," or a custom name. Categories exist so
similar foods can be compared by price per gram, milliliter, or count. Vegan,
peanuts, halal, and other filters are food traits, not categories.

A product is the packaged item, shared by every store. A store product is that
item at one address. Prices are added over time and are never edited.

### Offer pipeline (Collect → Normalize → Validate → Match)

All automated shelf prices and discount policies go through the Node pipeline in
[`../../../backend/pipeline`](../../../backend/pipeline): collectors emit a
shared envelope, then `ingestShelf` / `ingestPromotion` validate, match
store/product, and write `prices` or `promotions`. Manual reports use
`report_manual_price` (same `prices` table, `source = user_report`).

Planning Match uses `price_options`, which reads `trusted_current_prices`
(latest `user_report` beats newer `api` / `scrape`) and joins applicable
`promotions` for estimated savings. Live search uses
`searchShelfPrices` / `mergeOffers` with the same trust rule.

### Stability priority (product + price)

Highest first:

1. **Identity** — match by UPC, else name+brand; never merge conflicting UPCs.
2. **Trusted price** — `user_report` beats newer `api` / `scrape`.
3. **Freshness** — prefer prices under 24 hours (`is_stale`). Fresh manual
   reports block automated appends; stale automated prices may refresh.
4. **Completeness** — fill missing `upc`, brand, and size only when null
   (`product_price_health` scores listings: price 40, fresh 25, upc 20, size 15).
5. **Promotions** — calendar discounts apply on top of trusted shelf cents.

Categories may set `typical_shelf_life_days`; a product may override with
`shelf_life_days`. Planning ranks offers by waste-adjusted
`effective_cents_per_base` (price divided by how much the group can finish
before spoil), using habits for daily usage when present, otherwise
`amount_base / 7`. Budget checks still use real `line_cents`. When a purchase
is recorded without an explicit expiration, `expires_on` defaults from that
shelf life.

A shopping trip is one grocery date for a group. Each store on that trip gets
its own order. The trip also stores how the group will receive the food:
`self_pickup` (shop in person), `store_pickup` (order for pickup), or
`delivery` (ship to a saved address). Delivery requires `delivery_location_id`
on the trip; the other methods leave that null. The buyer confirms an order and
then places it. Placing the order freezes purchase rows and splits the total
evenly. The person in `purchases.user_id` paid. That field does not say who will
eat the food.

A usage habit belongs to the group. "Eggs every 14 days" is shared by the
household. When it comes due, it is added to the group's default list.

Trending is a view, not a table. Organic rows count real purchases or recipe
adds. Sponsored rows are paid placements. A sponsor does not increase the
organic score.

Profile pictures live in the `avatars` bucket. Product, recipe, and college
images live in `public-assets`. The database stores the file path only.

## Rules that are easy to get wrong

- Weekdays are `0` Sunday through `6` Saturday.
- Money is integer cents.
- `usual_amount_base` and ingredient amounts use the category unit: `g`, `ml`, or `ct`.
- Habits improve recommendations: without one, perishable ranking falls back to `amount_base / 7` or no waste penalty.
- Null shelf life means non-perishable for ranking (full pack counts as usable).
- Ingredients, allergens, and chemicals can only be marked `contains` or `may_contain`, and a user can only avoid them.
- Dietary properties use `suitable`. Certifications use `certified`. Users can require or prefer those.
- No trait row means unknown. It does not mean the product is safe for a required diet.
- A shared plan uses the strictest rule among current members. The function does not reveal which person set the rule.
- Do not mark an order ordered yourself. Call `finalizeOrder`. That writes the receipt and the shares.
- The non-payers each owe the floor of `total / member count`. The payer covers the leftover cents.
- `products.is_active = false` means recalled or discontinued. Do not delete the product, because old receipts point at it.
- `store_products.is_available` only means that store currently sells it.
- Sponsored trending rows have `source: "sponsored"` and a null score. Show them as sponsored.
- Push tokens are device addresses. There is no notification inbox.
- Ripeness photos are not stored.

## Which function to call

| Screen action | Function | What you get back |
| --- | --- | --- |
| Create an account | `signUp` | A user id. The profile and personal list already exist. |
| Sign in or out | `signIn`, `signInWithGoogle`, `signOut`, `getSession` | The device session. |

| Read or edit settings | `getMyProfile`, `updateMyProfile` | The caller's profile, including the weekly budget. |
| Set a food filter | `setMyFoodRules` | Nothing. The database rejects an illegal mode. |
| Save a dorm or home address | `saveMyLocation` | The saved address. |
| Start a household or party | `createGroup` | The new group id and its default list. |
| Join or leave | `joinGroup`, `leaveGroup` | The group id, or an error for the personal group. |
| See who owes whom | `listGroupBalances` | Unpaid shares. |
| Add milk, a barcode, or a custom line | `addListItem` | The list item. Pass exactly one target. |
| Add a recipe to the list | `addRecipeToList` | How many ingredient lines were added. |
| Show the list | `listResolvedItems` | Names and the cheapest shelf price, before coupons and food rules. |
| Choose the grocery day | `suggestGroceryDate` | The next preferred calendar date. |
| Best day from price history | `suggestBestShopDate` | Uses append-only `prices` day-of-week stats near a ZIP, plus promotions and preferred days. Returns `shopOn` + `reasonLabel`. |
| Weekly Shopping board | `getWeeklyShoppingBoard` | Days tab columns: Shop Today, Recommended Shop Date, Best Deal Day (eligibilities + optional time window). |
| Compare stores for one food | `priceOptions` | Offers that already follow the group's strictest rules, with waste-adjusted `effective_cents_per_base`. |
| Plan the whole list | `recommendShoppingPlan` | One line per item, the store (picked by effective cost), and whether the estimate is over budget. |
| Turn the plan into drafts | `createTripFromList` | The trip id. Pass `fulfillmentMethod` (`self_pickup`, `store_pickup`, or `delivery`) and, for delivery, `deliveryLocationId`. One draft order is created per store. |
| Buyer accepts the order | `confirmOrder` | Nothing. The caller becomes the payer. |
| Place the confirmed order | `finalizeOrder` | Nothing. Purchases and shares are written. |
| Open Instacart | `requestCheckoutLink` | A URL saved on the order. |
| Record a store receipt | `recordPurchase` | The purchase id. Pass `expiresOn` if known; otherwise shelf life fills it. |
| Add a Trader Joe's or campus store | `registerReportableStore` | The store id. Campus stores need `collegeName`. Scraped chain stores already exist from the price proxy. |
| Report a shelf price at any store | `reportManualPrice` | The price id. Pass cents. Manual reports override api/scrape prices for that listing. |
| List stores that accept reports | `listReportableStores` | Every store. |
| Resolve ZIP for price ingest | `resolveShopZip` | Saved postal code, GPS reverse geocode, or campus `98195`. |
| Fill / refresh catalog on search | `ensureCatalogForTerm` | Hits the multi-store price proxy (cooldown; skips cooldown on retailer errors), then re-reads products. |
| Refresh PDP store prices | `refreshProductStoreOffers` | Proxies by UPC or name; bypasses cooldown when any offer is from a prior local calendar day. |
| Format price time locally | `formatLocalDateTime` | Device-timezone display for `observedAt` on store offers. |
| Shop aisle chips | `listCategories` | Top-level aisles plus Produce children (Fruits, Vegetables). OFF taxonomy maps into these; keyword fallback for no UPC. |
| Popular carousel with no history | `listCampusPopularProducts` | Recently priced products for “Popular on campus”. |
| Barcode with ingest on miss | `findOrIngestProductByUpc` | Local UPC lookup, then QFC ingest via the proxy. |
| Remember that eggs last two weeks | `saveHabit` | The group habit. |
| Add due foods to the list | `addDueHabitItems` | How many new list rows were created. |
| Show the trending tab | `listTrending` | Organic and sponsored rows. Label the sponsored ones. |
| Check a recall or ingredient change | `getProductSafety`, `traitsChangedSince` | Active flag, traits, and conflicts with the caller's rules. |
| Register this phone | `registerPushToken` | The Expo token, or null when permission was denied. |
| Check ripeness | `analyzeRipeness` | A label. The photo is discarded. |

## Setup

1. Copy `.env.example` to `.env.local` (or `.env`).
2. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Apply migrations:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

4. Regenerate types after a migration:

```bash
npx supabase gen types typescript --linked > src/backend/types/database.ts
```

Then keep [`../types/index.ts`](../types/index.ts) exporting the shared names screens need.

## GitHub deploys the database

Connect the repo in Supabase Integrations and enable **Deploy to production** for
`main`. Migrations under `supabase/migrations` are the source of truth. Do not
edit production tables in the dashboard after that.

## Checks

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
