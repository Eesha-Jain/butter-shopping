# Supabase guide

Screens should import functions from `@/supabase`. Those functions are the app's
data API. The comments above each function say which records it uses and which
rule the caller has to follow.

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
item at one address. Prices are added over time and are never edited. The latest
price is the current shelf price.

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
| Sign in or out | `signIn`, `signOut`, `getSession` | The device session. |
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
| Compare stores for one food | `priceOptions` | Offers that already follow the group's strictest rules. |
| Plan the whole list | `recommendShoppingPlan` | One line per item, the store, and whether the estimate is over budget. |
| Turn the plan into drafts | `createTripFromList` | The trip id. Pass `fulfillmentMethod` (`self_pickup`, `store_pickup`, or `delivery`) and, for delivery, `deliveryLocationId`. One draft order is created per store. |
| Buyer accepts the order | `confirmOrder` | Nothing. The caller becomes the payer. |
| Place the confirmed order | `finalizeOrder` | Nothing. Purchases and shares are written. |
| Open Instacart | `requestCheckoutLink` | A URL saved on the order. |
| Record a store receipt | `recordPurchase` | The purchase id. Set the expiration date now if you know it. |
| Add a Trader Joe's or campus store | `registerReportableStore` | The store id. Campus stores need `collegeName`. |
| Report a shelf price there | `reportManualPrice` | The price id. Pass cents. QFC and Safeway prices are not reported this way. |
| List stores that accept reports | `listReportableStores` | Trader Joe's and campus stores. |
| Remember that eggs last two weeks | `saveHabit` | The group habit. |
| Add due foods to the list | `addDueHabitItems` | How many new list rows were created. |
| Show the trending tab | `listTrending` | Organic and sponsored rows. Label the sponsored ones. |
| Check a recall or ingredient change | `getProductSafety`, `traitsChangedSince` | Active flag, traits, and conflicts with the caller's rules. |
| Register this phone | `registerPushToken` | The Expo token, or null when permission was denied. |
| Check ripeness | `analyzeRipeness` | A label. The photo is discarded. |

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Supabase API settings. These are public values.
3. Install dependencies with `npm install`. `@supabase/supabase-js` and `expo-sqlite` are already declared. The SQLite package stores the login session on device.
4. Apply the migrations to the linked project:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The first migration rebuilds the application tables. It is appropriate for this new, disposable database. Do not edit an already-applied migration. Add a new file under `supabase/migrations` for every later change.

5. Regenerate types after a migration:

```bash
npx supabase gen types typescript --linked > src/supabase/database.types.ts
```

The committed types match the baseline. Keep the comments in the TypeScript modules when replacing the generated file, or move those comments back after generation.

## GitHub deploys the database

Supabase applies files in `supabase/migrations` when GitHub deploys the project. It does not run `src/supabase/schema.sql`.

1. In the Supabase dashboard, open Integrations and connect this GitHub repository.
2. Enable **Deploy to production** for the `main` branch.
3. After that, merge schema changes to `main` instead of editing tables in the dashboard. Dashboard edits skip the migration history and later deploys fail.
4. Optional: enable Automatic Branching if the plan includes a separate database for each pull request. Production deploy works without it.

Edge Functions in `supabase/functions` and the buckets declared in `supabase/config.toml` deploy with the same integration.

## Secrets and schedules

Set function secrets in the hosted project, not in the Expo app:

```bash
npx supabase secrets set INSTACART_API_KEY=... VISION_API_URL=... VISION_API_KEY=... OPENFDA_API_KEY=...
```

`create-checkout-link` calls Instacart. `analyze-ripeness` calls the configured vision endpoint and discards the image. `sync-product-composition` reads Open Food Facts for one barcode. `sync-product-safety` deactivates products whose barcode appears in a current FDA or USDA recall. `send-due-reminders` pushes expiration and order-confirmation messages.

Scheduled jobs are created only after these Vault secrets exist:

```sql
select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

Re-run `supabase/migrations/20261017130100_app_functions.sql` only if it has not been applied. On a database that already applied it, create the two cron jobs from that file's final block manually. The habit job runs inside the database. Reminder and recall jobs call Edge Functions. Delivery is best-effort: there is no saved notification queue, so a failed push is not retried automatically.

## Checks

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
