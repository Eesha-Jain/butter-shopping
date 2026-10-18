# Butter Shopping

**No BS grocery shopping for college students.**

Butter Shopping is a meal-prep and grocery app built for campus life. It helps you decide *when* and *where* to shop, stretch a dining plan or grocery budget, and keep your kitchen stocked without the usual guesswork.

Built with [Expo](https://expo.dev) / React Native and [Supabase](https://supabase.com).

## What it does

Once you build a grocery list and track how often you use items, Butter figures out the best shopping days from current prices, coupons, and discounts. It can suggest visiting one store or splitting across a few for the lowest total, including college grocery stores near campus.

Orders can be placed from your usual habits, with a confirmation notification before anything goes through — so you stay in control of what you spend.

## Features

### Smart shopping days
- Recommends the best day to shop from your list, live prices, sales, and available coupons
- Compares single-store vs multi-store trips for the lowest price
- Factors in preferred stores and how often you actually use items

### Built for campus budgets
- Works with college grocery stores and dining-plan constraints
- Respects how much you want to spend on groceries
- Optional opt-in for eligibility-based discounts (e.g. veterans, elderly, and similar programs) when choosing the best day and prices

### Cart & automatic ordering
- Grocery cart tied to your list and usage patterns
- Place orders based on habits of use
- Confirmation notifications before an order goes out
- Support for preferred payment and transportation details when ordering online

### Dietary labels & safety
- Clear labels for vegan, vegetarian, halal, organic, GMO-free, gluten-free, and kosher
- Track food and chemical sensitivities; flag products that contain them
- Alerts when items you usually buy are recalled or change ingredients

### Discover
- Trending meals and snacks tab tailored to what students are buying and cooking

### AI shopping assistant
- Voice-activated and chat-based AI agent to help with lists, recommendations, and shopping questions
- Rich notification experience for reminders and confirmations

### Kitchen helpers
- Expiration-date reminders so food doesn’t go to waste
- Image-based ripeness checks to help pick fruit and vegetables
- Upload photos of in-store prices or mark items out of stock to keep data fresh

### Share the haul
- Create a party, invite friends, and split grocery expenses within the group

### Experience
- Light, green-forward UI with haptics on actions like add-to-cart
- Location-aware preferred stores

## Getting started

1. Install dependencies:

   ```bash
   npm install
   cd backend && npm install && cd ..
   ```

2. Copy [`.env.example`](./.env.example) to `.env.local` and fill Supabase keys. For the price proxy, also set the vars in [`backend/.env.example`](./backend/.env.example) (Kroger + `SUPABASE_SERVICE_ROLE_KEY`) in `.env.local` or `src/backend/.env`.

3. Apply migrations (`npx supabase db push`), then start the price proxy and the app:

   ```bash
   cd backend && npm start
   # other terminal
   npx expo start
   ```

4. Confirm persist is on, then bootstrap the campus catalog once:

   ```bash
   curl http://127.0.0.1:3000/api/health
   # expect: { "qfc": true, "safeway": true, "persist": true }

   cd backend && npm run bootstrap:uw
   ```

Then open it in a [development build](https://docs.expo.dev/develop/development-builds/introduction/), [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/), [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/), or [Expo Go](https://expo.dev/go).

App routes live under `src/app/` using [Expo Router](https://docs.expo.dev/router/introduction/) file-based routing.

## How the product catalog fills

The Shop tab **reads** Supabase only. Real products are written by the Node price proxy (service role), not by fake seed rows and not on every app open.

| Path | When | What happens |
| --- | --- | --- |
| Staple bootstrap | Ops / before demo | `npm run bootstrap:uw` hits `/api/prices` for campus staple terms (ZIP `98195`), upserts products + prices, then assigns categories |
| Shop search miss | User search with fewer than 3 local hits | App calls `/api/prices` for that term + resolved ZIP, then re-queries Supabase |
| Planning | `planLowestTrip` | Same proxy path per list item |
| Barcode | `findOrIngestProductByUpc` | QFC lookup by UPC via `/api/products/by-upc`, optional OFF enrich |
| User report | TJ / campus only | `reportManualPrice` creates product + listing |

ZIP resolution: saved location → GPS reverse geocode → campus default `98195`. Retailer calls are cooled down server-side (5 min) and client-side (10 min) per term+zip.

Production apps should set `EXPO_PUBLIC_BACKEND_URL` to your deployed proxy (see [`src/api/config.js`](./src/api/config.js)).

## Roadmap / checklist

Track what’s done and what’s left. Check items off as they land. Product depth lives in [`docs/`](./docs/).

### Foundations
- [x] Expo Router app shell with Shop / Nearby / Days / AI / Cart tabs
- [x] Supabase project, schema, and migrations
- [x] Backend data layer (`src/backend`) — screens call helpers, not the raw client
- [x] Auth: email/password, Google OAuth, session provider, guest browse mode
- [x] Guest cart + merge into account list after sign-up
- [ ] Profile / settings screen (display name, avatar, dietary prefs, budget)
- [ ] Push notification setup (reminders, order confirmations, recalls)
- [ ] EAS development build + production build profiles wired for the team

### Shop
- [x] Product browse, search, categories, sale badges
- [x] Filters drawer (avoid / require / prefer / sort / on sale)
- [x] Product detail sheet + add-to-list with quantity and haptics
- [x] Active list switcher (personal vs roommate / group lists)
- [x] Staples + trending discovery bands
- [x] Campus catalog ingest (QFC/Safeway proxy + staple bootstrap + Shop search-miss)
- [ ] Reliable live prices across all preferred stores (ongoing refresh)
- [ ] Aisle / in-store navigation for pickup lists

### Nearby & preferred stores
- [x] Nearby shops list from location
- [ ] Preferred stores on the profile and used in planning
- [ ] Stock / out-of-stock signals and “mark missing” from the aisle
- [ ] Upload photos of shelf prices to refresh data

### Days (smart shopping)
- [ ] Replace Days placeholder with real planning UI
- [ ] Recommend best shopping day from list, prices, sales, and coupons
- [ ] Compare single-store vs multi-store trips
- [ ] Budget / dining-plan constraints in recommendations
- [ ] Optional eligibility-based discount opt-in (veterans, elderly, etc.)
- [ ] Trip creation → per-store orders from a list

### Cart & ordering
- [x] Guest cart UI
- [ ] Signed-in cart tied to the active grocery list
- [ ] Checkout / place order flow (pickup or delivery)
- [ ] Confirmation step + notification before an order goes out
- [ ] Preferred payment and transportation details when ordering online
- [ ] Habit-based auto-add of due staples to the list

### Dietary labels & safety
- [x] Food traits + user food rules in the data model and Shop filters
- [ ] Clear product labels (vegan, vegetarian, halal, organic, GMO-free, gluten-free, kosher)
- [ ] Sensitivity tracking with product flags for allergens / chemicals
- [ ] Recall and ingredient-change alerts for usual buys

### AI assistant
- [x] Voice agent tab (ElevenLabs), gated behind auth
- [ ] Chat-based assistant alongside voice
- [ ] Agent actions that edit lists, answer prices, and suggest shopping days
- [ ] Rich notification experience driven by the assistant

### Kitchen helpers
- [ ] Expiration-date reminders
- [ ] Image-based ripeness checks for produce
- [ ] Waste-aware recommendations using purchase + habit data

### Share the haul
- [ ] Create / join a party or household with invite codes
- [ ] Shared lists and split grocery expenses within the group

### Polish & shipping
- [x] Light, green-forward UI direction and brand fonts
- [x] Product / UX docs (market research, Shop user stories)
- [ ] Consistent empty / error / loading states across all tabs
- [ ] Accessibility pass (fonts, contrast, hit targets)
- [x] Demo catalog bootstrap (`backend` staple ingest) — pitch / walkthrough script still open
- [ ] Short pitch / walkthrough script for DubHacks
