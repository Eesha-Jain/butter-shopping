/**
 * Keyword → campus category name (Fruits / Vegetables under Produce).
 * Longer / more specific patterns are checked first.
 */

export const CATEGORY_KEYWORDS = [
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
  { category: "Snacks", patterns: ["chip", "granola", "cracker", "cookie", "ramen", "cereal", "bar"] },
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
  return "Pantry";
}
