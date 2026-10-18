/**
 * Keyword → top-level category name. Used after staple ingest to set
 * products.category_id when the retailer payload has no category.
 * Longer / more specific keys should be checked first.
 */
export const CATEGORY_KEYWORDS = [
  {
    category: 'Other',
    patterns: [
      'detergent',
      'dish soap',
      'soap',
      'shampoo',
      'conditioner',
      'toothpaste',
      'toothbrush',
      'paper towel',
      'toilet paper',
      'toilet',
      'trash bag',
      'garbage bag',
      'battery',
      'batteries',
      'charger',
      'bandage',
      'band-aid',
      'vitamin',
      'supplement',
      'candle',
      'pet litter',
      'cat litter',
      'laundry',
      'fabric softener',
      'cleaner',
      'bleach',
      'deodorant',
      'lotion',
      'razor',
      'mouthwash',
      'diaper',
      'napkin',
      'tissue',
      'aluminum foil',
      'plastic wrap',
      'ziploc',
      'trash',
    ],
  },
  { category: 'Dairy', patterns: ['milk', 'oat milk', 'yogurt', 'butter', 'cheese', 'cream', 'egg'] },
  { category: 'Meat & Seafood', patterns: ['chicken', 'beef', 'salmon', 'turkey', 'pork', 'shrimp', 'tofu'] },
  { category: 'Produce', patterns: ['banana', 'apple', 'spinach', 'avocado', 'potato', 'onion', 'tomato', 'lettuce'] },
  { category: 'Frozen', patterns: ['frozen', 'ice cream', 'pizza'] },
  { category: 'Bakery', patterns: ['bread', 'bagel', 'tortilla', 'bun'] },
  { category: 'Beverages', patterns: ['coffee', 'juice', 'water', 'soda', 'tea'] },
  { category: 'Snacks', patterns: ['chip', 'granola', 'cracker', 'cookie', 'ramen', 'cereal', 'bar'] },
  { category: 'Pantry', patterns: ['rice', 'pasta', 'oil', 'peanut butter', 'bean', 'salsa', 'hummus', 'flour', 'sugar'] },
];

export function categoryForProductName(name) {
  const text = String(name ?? '').toLowerCase();
  if (!text) return null;
  for (const row of CATEGORY_KEYWORDS) {
    if (row.patterns.some((pattern) => text.includes(pattern))) {
      return row.category;
    }
  }
  return 'Other';
}
