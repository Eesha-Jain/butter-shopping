/**
 * Maps Open Food Facts taxonomy tags → campus category names
 * (Fruits / Vegetables under Produce, plus top-level aisles).
 * Keep in sync with backend/off-category-map.js.
 */

type OffLike = Record<string, unknown>;

function collectTags(off: OffLike | null | undefined): string[] {
  const tags: string[] = [];
  if (!off) return tags;
  for (const key of ["pnns_groups_1", "pnns_groups_2", "food_groups", "food_group"]) {
    const value = off[key];
    if (typeof value === "string" && value.trim()) tags.push(value);
  }
  for (const key of [
    "food_groups_tags",
    "categories_tags",
    "pnns_groups_1_tags",
    "pnns_groups_2_tags",
  ]) {
    const arr = off[key];
    if (Array.isArray(arr)) {
      for (const tag of arr) {
        if (typeof tag === "string") tags.push(tag);
      }
    }
  }
  return tags.map((tag) => tag.toLowerCase());
}

/** Campus aisle / produce subcategory name, or null when unknown. */
export function categoryFromOffProduct(off: OffLike | null | undefined): string | null {
  const tags = collectTags(off);
  if (tags.length === 0) return null;
  const text = tags.join(" ");

  if (
    /\b(breads?|bakery|pastries|cakes?|biscuits?|cookies?|bagels?)\b/.test(text) ||
    text.includes("en:breads") ||
    text.includes("en:cakes")
  ) {
    return "Bakery";
  }

  // Drink forms beat fruit tags (smoothies, sparkling water, juices, soft drinks).
  const drinkForm =
    text.includes("en:fruit-juices") ||
    text.includes("en:smoothies") ||
    text.includes("en:sparkling-waters") ||
    text.includes("sparkling-water") ||
    text.includes("en:soft-drinks") ||
    text.includes("en:lemonades") ||
    text.includes("en:kombuchas") ||
    (text.includes("juice") && text.includes("beverage")) ||
    /\b(smoothies?|sparkling|lemonades?|kombuchas?|nectars?|soft-drinks|sodas?)\b/.test(text);
  if (drinkForm) {
    return "Beverages";
  }
  // Generic beverage aisle — do not steal fresh produce (or plant-based-foods-and-beverages).
  if (
    (text.includes("en:beverages") ||
      /\b(soft-drinks|sodas?|teas?|coffees?)\b/.test(text) ||
      (/\bwaters?\b/.test(text) && !text.includes("en:fruits") && !text.includes("en:vegetables"))) &&
    !text.includes("en:fresh-fruits") &&
    !text.includes("en:fruits")
  ) {
    return "Beverages";
  }

  // Snacks before Fruits so chip tags win over fruit-flavor / avocado tags.
  if (
    text.includes("en:snacks") ||
    text.includes("en:chips") ||
    text.includes("en:chocolates") ||
    text.includes("en:cereals") ||
    text.includes("salty-snacks")
  ) {
    return "Snacks";
  }

  if (
    text.includes("en:fruits") ||
    text.includes("en:fresh-fruits") ||
    text.includes("en:dried-fruits") ||
    text.includes("fruit-based") ||
    text.includes("fruit-puree") ||
    (text.includes("purees") && text.includes("fruit")) ||
    /\b(bananas?|apples?|berries|oranges?|mango|grapes?|pears?|peaches?)\b/.test(text)
  ) {
    return "Fruits";
  }

  if (
    text.includes("en:vegetables") ||
    text.includes("en:fresh-vegetables") ||
    text.includes("en:leafy-vegetables") ||
    /\b(spinach|lettuce|tomatoes?|onions?|potatoes?|carrots?|broccoli|cucumbers?)\b/.test(text)
  ) {
    return "Vegetables";
  }

  if (text.includes("fruits-and-vegetables") || text.includes("en:fruits-and-vegetables")) {
    return "Produce";
  }

  if (
    text.includes("en:dairies") ||
    text.includes("en:milks") ||
    text.includes("en:yogurts") ||
    text.includes("en:cheeses") ||
    text.includes("dairy") ||
    text.includes("en:eggs")
  ) {
    return "Dairy";
  }

  if (
    text.includes("en:meats") ||
    text.includes("en:fishes") ||
    text.includes("en:seafood") ||
    text.includes("meat") ||
    text.includes("poultry")
  ) {
    return "Meat & Seafood";
  }

  if (text.includes("en:frozen") || text.includes("frozen-foods") || text.includes("ice-creams")) {
    return "Frozen";
  }

  if (
    text.includes("en:plant-based-foods") ||
    text.includes("en:groceries") ||
    text.includes("en:pastas") ||
    text.includes("en:rices") ||
    text.includes("en:oils")
  ) {
    return "Pantry";
  }

  return null;
}
