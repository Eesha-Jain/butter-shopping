/**
 * On-device shop catalog: the whole active product list, traits and categories are
 * kept locally so aisle / home / favorites / search views are plain array filters.
 */
import {
  dedupeProductsByGroup,
  diversifyProducts,
  getJson,
  listAllActiveProducts,
  listAllCategories,
  listAllProductTraits,
  setJson,
  type CategoryProductSection,
  type Product,
  type ProductCategory,
  type ProductTrait,
} from '@/backend';

const CACHE_VERSION = 3;
const EXCLUDED_BROWSE_CATEGORIES = new Set(['other']);

export type ShopCatalog = {
  products: Product[];
  traits: ProductTrait[];
  /** Every category, including children (for aisle lookups). */
  allCategories: ProductCategory[];
};

type CachedTrending = { product: Product; sponsored: boolean }[];

type ShopCatalogCache = ShopCatalog & {
  v: typeof CACHE_VERSION;
  savedAt: number;
  prices: [string, number][];
  trending: CachedTrending;
};

export function readShopCatalogCache():
  | (ShopCatalog & { prices: [string, number][]; trending: CachedTrending })
  | null {
  const cached = getJson<ShopCatalogCache>('shopHomeCache');
  if (
    !cached ||
    cached.v !== CACHE_VERSION ||
    !Array.isArray(cached.products) ||
    !Array.isArray(cached.traits) ||
    !Array.isArray(cached.allCategories) ||
    !Array.isArray(cached.prices) ||
    !Array.isArray(cached.trending)
  ) {
    return null;
  }
  return cached;
}

export function writeShopCatalogCache(
  catalog: ShopCatalog,
  prices: Map<string, number>,
  trending: CachedTrending,
): void {
  setJson('shopHomeCache', {
    v: CACHE_VERSION,
    savedAt: Date.now(),
    // Ingredients are never shown on browse cards; drop them to keep the cache small.
    products: catalog.products.map((row) =>
      row.ingredients_text == null ? row : { ...row, ingredients_text: null },
    ),
    traits: catalog.traits,
    allCategories: catalog.allCategories,
    prices: [...prices],
    trending,
  } satisfies ShopCatalogCache);
}

/** Aisle chips: Produce, its children, then the other top-level categories A→Z. */
export function browseCategories(allCategories: ProductCategory[]): ProductCategory[] {
  const byName = (a: ProductCategory, b: ProductCategory) => a.name.localeCompare(b.name);
  const top = allCategories.filter((row) => row.parent_id == null).sort(byName);
  const produce = top.find((row) => row.name.toLowerCase() === 'produce');
  if (!produce) return top;
  const children = allCategories.filter((row) => row.parent_id === produce.id).sort(byName);
  return [produce, ...children, ...top.filter((row) => row.id !== produce.id)];
}

export async function fetchShopCatalog(): Promise<ShopCatalog> {
  const [products, traits, allCategories] = await Promise.all([
    listAllActiveProducts(),
    listAllProductTraits().catch(() => [] as ProductTrait[]),
    listAllCategories(),
  ]);
  return { products, traits, allCategories };
}

/** Home rows: one diversified preview per browse category, newest first. */
export function buildHomeSections(
  products: Product[],
  browseCategories: ProductCategory[],
  perCategory: number,
): CategoryProductSection[] {
  const byCategory = new Map<string, Product[]>();
  for (const row of products) {
    if (!row.category_id) continue;
    const list = byCategory.get(row.category_id);
    if (list) list.push(row);
    else byCategory.set(row.category_id, [row]);
  }
  const sections: CategoryProductSection[] = [];
  for (const category of browseCategories) {
    if (EXCLUDED_BROWSE_CATEGORIES.has(category.name.toLowerCase())) continue;
    const rows = byCategory.get(category.id);
    if (!rows?.length) continue;
    const newest = [...rows]
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .slice(0, Math.max(perCategory * 3, 24));
    sections.push({ category, products: diversifyProducts(newest, perCategory) });
  }
  return sections;
}

/** Full aisle (category + its children), one card per product group, Aâ†’Z. */
export function productsInAisle(
  products: Product[],
  allCategories: ProductCategory[],
  categoryId: string,
): Product[] {
  const ids = new Set([
    categoryId,
    ...allCategories.filter((row) => row.parent_id === categoryId).map((row) => row.id),
  ]);
  const rows = products
    .filter((row) => row.category_id != null && ids.has(row.category_id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return dedupeProductsByGroup(rows);
}

export function productMatchesSearch(product: Product, query: string): boolean {
  const q = query.toLowerCase();
  return (
    product.name.toLowerCase().includes(q) ||
    (product.display_name?.toLowerCase().includes(q) ?? false) ||
    (product.brand?.toLowerCase().includes(q) ?? false)
  );
}

export function searchCatalog(products: Product[], query: string): Product[] {
  return dedupeProductsByGroup(products.filter((row) => productMatchesSearch(row, query)));
}

/** Adds/replaces rows by id, keeping existing order. */
export function mergeProducts(base: Product[], incoming: Product[]): Product[] {
  if (incoming.length === 0) return base;
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const merged = base.map((row) => incomingById.get(row.id) ?? row);
  const known = new Set(base.map((row) => row.id));
  for (const row of incoming) if (!known.has(row.id)) merged.push(row);
  return merged;
}
