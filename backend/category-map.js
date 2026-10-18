/**
 * Keyword → campus category name (Fruits / Vegetables under Produce).
 * Longer / more specific patterns are checked first.
 */

export const CATEGORY_KEYWORDS = [
  {
    category: "Other",
    patterns: [
      "detergent",
      "dish soap",
      "soap",
      "shampoo",
      "conditioner",
      "toothpaste",
      "toothbrush",
      "paper towel",
      "toilet paper",
      "toilet",
      "trash bag",
      "garbage bag",
      "battery",
      "batteries",
      "charger",
      "bandage",
      "band-aid",
      "vitamin",
      "supplement",
      "candle",
      "pet litter",
      "cat litter",
      "laundry",
      "fabric softener",
      "cleaner",
      "bleach",
      "deodorant",
      "lotion",
      "razor",
      "mouthwash",
      "diaper",
      "napkin",
      "tissue",
      "aluminum foil",
      "plastic wrap",
      "ziploc",
      "trash",
      // Personal care — before fruit tokens (e.g. Banana Boat sunscreen).
      "sunscreen",
      "sunblock",
      "sun block",
      "after sun",
      "spf",
      "banana boat",
      "bananaboat",
    ],
  },
  // Bakery overrides fruit tokens in compound names.
  {
    category: "Bakery",
    patterns: ["banana bread", "apple pie", "bread", "bagel", "tortilla", "bun", "muffin", "croissant"],
  },
  { category: "Frozen", patterns: ["frozen", "ice cream", "frozen pizza"] },
  {
    category: "Beverages",
    patterns: ["fruit juice", "orange juice", "apple juice", "coffee", "juice", "water", "soda", "tea"],
  },
  {
    category: "Dairy",
    patterns: ["oat milk", "almond milk", "milk", "yogurt", "butter", "cheese", "cream", "egg"],
  },
  {
    category: "Meat & Seafood",
    patterns: ["chicken", "beef", "salmon", "turkey", "pork", "shrimp", "tofu"],
  },
  // Snacks before Fruits so "avocado chips" / fruit-flavored crisps land here.
  {
    category: "Snacks",
    patterns: ["chip", "chips", "crisp", "granola", "cracker", "cookie", "ramen", "cereal", "bar"],
  },
  // Fruit (incl. purees) — same family as fresh bananas.
  {
    category: "Fruits",
    patterns: [
      "banana puree",
      "fruit puree",
      "apple sauce",
      "applesauce",
      "banana",
      "apple",
      "berry",
      "berries",
      "strawberry",
      "blueberry",
      "mango",
      "grape",
      "orange",
      "pear",
      "peach",
      "melon",
      "watermelon",
      "pineapple",
      "avocado",
      "lemon",
      "lime",
      "cherry",
      "kiwi",
      "fruit",
      "puree",
    ],
  },
  {
    category: "Vegetables",
    patterns: [
      "spinach",
      "lettuce",
      "tomato",
      "potato",
      "onion",
      "carrot",
      "broccoli",
      "cucumber",
      "pepper",
      "celery",
      "cabbage",
      "kale",
      "zucchini",
      "corn",
      "garlic",
      "vegetable",
    ],
  },
  {
    category: "Pantry",
    patterns: ["rice", "pasta", "oil", "peanut butter", "bean", "salsa", "hummus", "flour", "sugar"],
  },
];

export function categoryForProductName(name) {
  const text = String(name ?? "").toLowerCase();
  if (!text) return null;
  for (const row of CATEGORY_KEYWORDS) {
    if (row.patterns.some((pattern) => text.includes(pattern))) {
      return row.category;
    }
  }
  return "Other";
}
