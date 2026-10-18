/** SF Symbol names for top-level Shop categories. */
export const CATEGORY_ICONS = {
  Produce: 'leaf.fill',
  Dairy: 'drop.fill',
  'Meat & Seafood': 'fish.fill',
  Pantry: 'shippingbox.fill',
  Snacks: 'takeoutbag.and.cup.and.straw.fill',
  Beverages: 'cup.and.saucer.fill',
  Frozen: 'snowflake',
  Bakery: 'birthday.cake.fill',
  Other: 'bag.fill',
} as const;

export type CategoryIconName = (typeof CATEGORY_ICONS)[keyof typeof CATEGORY_ICONS] | 'tag.fill';

export function iconForCategory(name: string): CategoryIconName {
  return (CATEGORY_ICONS as Record<string, CategoryIconName>)[name] ?? 'tag.fill';
}
