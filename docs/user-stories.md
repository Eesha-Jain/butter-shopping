# Shop user stories

How different shoppers arrive at the Shop tab, and which surfaces serve them. Shop does not become a meal planner in v1 — deep “recipe → list” stays with AI / recipes.

## 1. Knows exactly what they want + brand

**Example:** “Horizon organic milk, half gallon.”

**Support**
- Debounced search by product name / brand
- Tap result → product bottom sheet → add with quantity
- Fast path: `+` on the card without opening the sheet
- Active list switcher so add goes to personal vs roommate list

## 2. Knows what they want, wants the cheapest

**Example:** “Eggs — whatever is cheapest.”

**Support**
- Search or category browse for the item type
- Filter drawer **Sort: Cheapest** (by known shelf/promo price when available)
- Sale badges (`20% off`, `$1 off`, `BOGO`) on cards
- Prefer / require filters still apply so “cheapest” does not violate allergies

## 3. Vague idea (meal / vibe)

**Example:** “Maybe fried rice this week.”

**Support on Shop (light)**
- Category chips (e.g. Produce, Pantry) + trending as campus inspiration
- Loose search terms (“rice”, “soy sauce”)
- Staples carousel as a reminder of what they already buy

**Not on Shop v1**
- Full recipe → ingredient list (AI agent / recipes flows)

## 4. Just wants to browse

**Example:** “Show me snacks” or “remind me what I might want.”

**Support**
- Category chips (3–4 visible + More) or All
- Vertical product grid with sale badges
- Staples + trending horizontal bands as gentle discovery — no forced query
- Filters seed from food preferences; Clear all if browsing for someone else

## Spatial model (consistent across stories)

| Action | Surface |
| --- | --- |
| Tap product (not `+`) | Bottom sheet — detail + add |
| Filter icon or swipe from right | Right drawer — avoid / require / prefer / sort / on sale |
| Tap `+` or qty | Inline on card + success haptic |

## Calm UI (Hick’s law)

Keep first-viewport primary choices around 3–4 (location, search, list target, filter). Limit visible category chips. At most two discovery carousels. Group filter controls into a few sections so users are not choosing among dozens of equal-weight toggles.
