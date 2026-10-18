import * as Crypto from 'expo-crypto';

import { BACKEND_URL, CAMPUS_DEFAULT_ZIP } from '../../api/config';
import type {
  CurrentPrice,
  NearbyStore,
  Price,
  Product,
  ProductCategory,
  ProductTrait,
  Promotion,
  ReportableStore,
  Store,
} from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { isPriorLocalCalendarDay, todayLocalDateKey } from './localTime';
import {
  contributeReportedPriceToOpenPrices,
  getOpenPricesCentsByUpcs,
  type OpenPriceRow,
  type OpenPricesGeo,
} from './open-prices';
import { unwrap, unwrapOne, unwrapVoid } from './query';
import {
  canonicalizeUpc,
  upcLookupValues,
} from '@/utils/product-identity';

/** Search-path chains: Kroger APIs only (scrapes run via bootstrap ingest). */
const SEARCH_CHAINS = 'qfc,fredMeyer';

/** Prefer display_name on cards when present. */
export function productCardName(product: Pick<Product, 'name' | 'display_name'>): string {
  const display = product.display_name?.trim();
  return display || product.name;
}

/** Stable group key for cross-store identity. */
export function productGroupKey(product: Pick<Product, 'id' | 'canonical_upc' | 'fingerprint' | 'upc'>): string {
  if (product.canonical_upc) return `u:${product.canonical_upc}`;
  const canon = canonicalizeUpc(product.upc);
  if (canon) return `u:${canon}`;
  if (product.fingerprint) return `f:${product.fingerprint}`;
  return `id:${product.id}`;
}

/**
 * All product ids that share UPC/fingerprint with this product (includes self).
 * Used for browse pricing and PDP multi-store offers.
 */
export async function resolveProductGroupIds(productId: string): Promise<string[]> {
  if (!productId) return [];
  const product = unwrap(
    await supabase
      .from('products')
      .select('id, upc, canonical_upc, fingerprint')
      .eq('id', productId)
      .maybeSingle(),
  ) as Pick<Product, 'id' | 'upc' | 'canonical_upc' | 'fingerprint'> | null;
  if (!product) return [productId];

  const ids = new Set<string>([productId]);
  const canon = product.canonical_upc ?? canonicalizeUpc(product.upc);
  if (canon) {
    const byCanon = unwrap(
      await supabase
        .from('products')
        .select('id')
        .eq('is_active', true)
        .eq('canonical_upc', canon),
    ) as { id: string }[];
    for (const row of byCanon) ids.add(row.id);
  }
  const upcValues = upcLookupValues(product.upc);
  if (upcValues.length > 0) {
    const siblings = unwrap(
      await supabase.from('products').select('id').eq('is_active', true).in('upc', upcValues),
    ) as { id: string }[];
    for (const row of siblings) ids.add(row.id);
  }
  if (product.fingerprint) {
    const soft = unwrap(
      await supabase
        .from('products')
        .select('id')
        .eq('is_active', true)
        .eq('fingerprint', product.fingerprint),
    ) as { id: string }[];
    for (const row of soft) ids.add(row.id);
  }
  return [...ids];
}

/** Collapse sibling products to one card (richest image / display name wins). */
export function dedupeProductsByGroup(products: Product[]): Product[] {
  const buckets = new Map<string, Product>();
  const score = (p: Product) =>
    (p.image_path ? 4 : 0) +
    (p.display_name ? 2 : 0) +
    (p.brand ? 1 : 0) +
    (p.canonical_upc || p.upc ? 1 : 0);

  for (const product of products) {
    const key = productGroupKey(product);
    const prior = buckets.get(key);
    if (!prior || score(product) > score(prior)) {
      buckets.set(key, product);
    }
  }
  return [...buckets.values()];
}

const CLIENT_INGEST_COOLDOWN_MS = 10 * 60 * 1000;
const ingestCooldown = new Map<string, number>();

/** Cooldown includes local calendar day so a new day always re-ingests. */
function ingestCooldownKey(term: string, zip: string): string {
  return `${zip}:${term.trim().toLowerCase()}:${todayLocalDateKey()}`;
}

function ingestOnCooldown(term: string, zip: string): boolean {
  const at = ingestCooldown.get(ingestCooldownKey(term, zip));
  if (at == null) return false;
  if (Date.now() - at > CLIENT_INGEST_COOLDOWN_MS) {
    ingestCooldown.delete(ingestCooldownKey(term, zip));
    return false;
  }
  return true;
}

function markIngest(term: string, zip: string): void {
  ingestCooldown.set(ingestCooldownKey(term, zip), Date.now());
}

/**
 * Searches comparable categories such as whole milk. Dietary words such as vegan
 * are food traits, not categories, so use listFoodTraits for those filters.
 */
export async function searchCategories(query: string): Promise<ProductCategory[]> {
  const term = safeSearch(query);
  return unwrap(
    await supabase.from('product_categories').select('*').ilike('name', `%${term}%`).limit(30),
  );
}

/**
 * Shop aisle chips: top-level categories plus Produce children (Fruits, Vegetables).
 * Ordered with Produce family first, then the rest alphabetically.
 */
export async function listCategories(input?: { limit?: number }): Promise<ProductCategory[]> {
  const limit = input?.limit ?? 50;
  const top = unwrap(
    await supabase
      .from('product_categories')
      .select('*')
      .is('parent_id', null)
      .order('name')
      .limit(limit),
  );
  const produce = top.find((row) => row.name.toLowerCase() === 'produce');
  let children: ProductCategory[] = [];
  if (produce) {
    children = unwrap(
      await supabase
        .from('product_categories')
        .select('*')
        .eq('parent_id', produce.id)
        .order('name'),
    );
  }
  const rest = top.filter((row) => row.name.toLowerCase() !== 'produce');
  const ordered = produce ? [produce, ...children, ...rest] : [...top];
  return ordered.slice(0, limit);
}

/**
 * Spreads browse results so one brand/name cluster (e.g. every pasta SKU)
 * cannot dominate the first screen.
 */
function diversifyProducts(rows: Product[], limit: number): Product[] {
  const unique = dedupeProductsByGroup(rows);
  if (unique.length <= limit) return unique;

  const groupKey = (product: Product) => {
    const brand = product.brand?.trim().toLowerCase();
    if (brand) return `b:${brand}`;
    const token = product.name.trim().toLowerCase().split(/\s+/)[0] ?? product.id;
    return `n:${token}`;
  };

  const buckets = new Map<string, Product[]>();
  for (const row of unique) {
    const key = groupKey(row);
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const queues = [...buckets.values()];
  const picked: Product[] = [];
  let progressed = true;
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= limit) break;
      const next = queue.shift();
      if (!next) continue;
      picked.push(next);
      progressed = true;
    }
  }
  return picked.slice(0, limit);
}

const DEFAULT_EXCLUDE_CATEGORY_NAMES = ['Other'];

function filterBrowseCategories(
  categories: ProductCategory[],
  excludeCategoryNames: string[] = DEFAULT_EXCLUDE_CATEGORY_NAMES,
): ProductCategory[] {
  const excluded = new Set(excludeCategoryNames.map((name) => name.toLowerCase()));
  return categories.filter((row) => !excluded.has(row.name.toLowerCase()));
}

export type CategoryProductSection = {
  category: ProductCategory;
  products: Product[];
};

/**
 * Food-first home sections: one product list per top-level category.
 * Other (non-food) is excluded by default.
 */
export async function listProductsGroupedByCategory(input?: {
  limitPerCategory?: number;
  excludeCategoryNames?: string[];
}): Promise<CategoryProductSection[]> {
  const limitPerCategory = input?.limitPerCategory ?? 10;
  const categories = filterBrowseCategories(
    await listCategories({ limit: 20 }),
    input?.excludeCategoryNames ?? DEFAULT_EXCLUDE_CATEGORY_NAMES,
  );
  if (categories.length === 0) return [];

  const batches = await Promise.all(
    categories.map(async (category) => {
      const rows = unwrap(
        await supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .eq('category_id', category.id)
          .order('created_at', { ascending: false })
          .limit(Math.max(limitPerCategory * 3, 24)),
      );
      return {
        category,
        products: diversifyProducts(rows, limitPerCategory),
      };
    }),
  );

  return batches.filter((section) => section.products.length > 0);
}

/** Active catalog products for browse. Optional category filter (Produce includes children). */
export async function listActiveProducts(input?: {
  limit?: number;
  categoryId?: string | null;
  excludeCategoryNames?: string[];
}): Promise<Product[]> {
  const limit = input?.limit ?? 60;

  if (input?.categoryId) {
    const children = unwrap(
      await supabase
        .from('product_categories')
        .select('id')
        .eq('parent_id', input.categoryId),
    );
    const ids = [input.categoryId, ...children.map((row) => row.id)];
    const rows = unwrap(
      await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .in('category_id', ids)
        .order('name')
        .limit(Math.max(limit * 4, 80)),
    );
    return diversifyProducts(rows, limit);
  }


  // Home browse: pull from each food category (skip Other) so pasta/dairy cannot fill the grid.
  const categories = filterBrowseCategories(
    await listCategories({ limit: 12 }),
    input?.excludeCategoryNames ?? DEFAULT_EXCLUDE_CATEGORY_NAMES,
  );
  if (categories.length === 0) {
    const rows = unwrap(
      await supabase.from('products').select('*').eq('is_active', true).order('name').limit(limit * 3),
    );
    return diversifyProducts(rows, limit);
  }

  const perCategoryFetch = Math.max(6, Math.ceil((limit * 2) / categories.length));
  const batches = await Promise.all(
    categories.map(async (category) =>
      unwrap(
        await supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .eq('category_id', category.id)
          .order('created_at', { ascending: false })
          .limit(perCategoryFetch),
      ),
    ),
  );

  const queues = batches.map((batch) => [...batch]);
  const interleaved: Product[] = [];
  let progressed = true;
  while (interleaved.length < limit * 2 && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (interleaved.length >= limit * 2) break;
      const next = queue.shift();
      if (!next) continue;
      interleaved.push(next);
      progressed = true;
    }
  }

  return diversifyProducts(interleaved, limit);
}

/** Hydrates product rows by id. Order follows the input ids when possible. */
export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = unwrap(await supabase.from('products').select('*').in('id', unique).eq('is_active', true));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Product trait rows for a batch of products (for session food filters). */
export async function getProductTraitsForIds(productIds: string[]): Promise<ProductTrait[]> {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return [];
  return unwrap(await supabase.from('product_traits').select('*').in('product_id', unique));
}

/**
 * Cheapest known shelf price (cents) per product across available store listings.
 * Expands UPC/fingerprint siblings so cross-store duplicates share one low price.
 * Missing ids mean no observed price yet.
 */
export async function getCheapestPriceCentsByProductIds(
  productIds: string[],
  geo?: OpenPricesGeo | null,
): Promise<Map<string, number>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const prices = new Map<string, number>();
  if (unique.length === 0) return prices;

  const products = unwrap(
    await supabase
      .from('products')
      .select('id, upc, canonical_upc, fingerprint')
      .in('id', unique)
      .eq('is_active', true),
  ) as Pick<Product, 'id' | 'upc' | 'canonical_upc' | 'fingerprint'>[];

  const groupKeyById = new Map<string, string>();
  const idsByGroup = new Map<string, Set<string>>();
  for (const product of products) {
    const key = productGroupKey(product);
    groupKeyById.set(product.id, key);
    const set = idsByGroup.get(key) ?? new Set<string>();
    set.add(product.id);
    idsByGroup.set(key, set);
  }

  // Expand soft siblings not in the request set (same fingerprint / canonical UPC).
  const canonKeys = [
    ...new Set(
      products
        .map((p) => p.canonical_upc ?? canonicalizeUpc(p.upc))
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const fingerprints = [
    ...new Set(products.map((p) => p.fingerprint).filter((v): v is string => Boolean(v))),
  ];
  const extraBatches: Pick<Product, 'id' | 'upc' | 'canonical_upc' | 'fingerprint'>[][] = [];
  if (canonKeys.length > 0) {
    extraBatches.push(
      unwrap(
        await supabase
          .from('products')
          .select('id, upc, canonical_upc, fingerprint')
          .eq('is_active', true)
          .in('canonical_upc', canonKeys),
      ) as Pick<Product, 'id' | 'upc' | 'canonical_upc' | 'fingerprint'>[],
    );
  }
  if (fingerprints.length > 0) {
    extraBatches.push(
      unwrap(
        await supabase
          .from('products')
          .select('id, upc, canonical_upc, fingerprint')
          .eq('is_active', true)
          .in('fingerprint', fingerprints),
      ) as Pick<Product, 'id' | 'upc' | 'canonical_upc' | 'fingerprint'>[],
    );
  }
  for (const product of extraBatches.flat()) {
    const key = productGroupKey(product);
    const set = idsByGroup.get(key) ?? new Set<string>();
    set.add(product.id);
    idsByGroup.set(key, set);
    groupKeyById.set(product.id, key);
  }

  const allIds = [...new Set([...groupKeyById.keys()])];
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, product_id')
      .in('product_id', allIds)
      .eq('is_available', true),
  );

  const groupMin = new Map<string, number>();
  if (listings.length > 0) {
    const storeProductIds = listings.map((row) => row.id);
    const current = unwrap(
      await supabase
        .from('trusted_current_prices')
        .select('store_product_id, price_cents')
        .in('store_product_id', storeProductIds),
    );
    const priceByStoreProduct = new Map(current.map((row) => [row.store_product_id, row.price_cents]));
    for (const listing of listings) {
      const cents = priceByStoreProduct.get(listing.id);
      if (cents == null) continue;
      const key = groupKeyById.get(listing.product_id);
      if (!key) continue;
      const prior = groupMin.get(key);
      if (prior == null || cents < prior) groupMin.set(key, cents);
    }
  }

  for (const id of unique) {
    const key = groupKeyById.get(id);
    if (!key) continue;
    const cents = groupMin.get(key);
    if (cents != null) prices.set(id, cents);
  }

  // Fill gaps with Open Prices (cached, geo-preferring) when products have UPCs.
  const missingIds = unique.filter((id) => !prices.has(id));
  if (missingIds.length === 0) return prices;

  const upcByProduct = new Map<string, string>();
  for (const row of products) {
    if (!missingIds.includes(row.id)) continue;
    const upc = String(row.upc ?? '').replace(/\D/g, '');
    if (/^\d{8,14}$/.test(upc)) upcByProduct.set(row.id, upc);
  }
  if (upcByProduct.size === 0) return prices;

  const openByUpc = await getOpenPricesCentsByUpcs([...upcByProduct.values()], geo);
  for (const [productId, upc] of upcByProduct) {
    const cents = openByUpc.get(upc);
    if (cents != null) prices.set(productId, cents);
  }
  return prices;
}

export type StoreShelfRow = {
  product: Product;
  priceCents: number;
};

async function categoryIdsIncludingChildren(categoryId: string): Promise<string[]> {
  const children = unwrap(
    await supabase.from('product_categories').select('id').eq('parent_id', categoryId),
  );
  return [categoryId, ...children.map((row) => row.id)];
}

async function pricesForListings(
  listings: { id: string; product_id: string }[],
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (listings.length === 0) return prices;
  const current = unwrap(
    await supabase
      .from('trusted_current_prices')
      .select('store_product_id, price_cents')
      .in(
        'store_product_id',
        listings.map((row) => row.id),
      ),
  );
  const priceByListing = new Map(current.map((row) => [row.store_product_id, row.price_cents]));
  for (const listing of listings) {
    const cents = priceByListing.get(listing.id);
    if (cents == null) continue;
    const prior = prices.get(listing.product_id);
    if (prior == null || cents < prior) prices.set(listing.product_id, cents);
  }
  return prices;
}

/**
 * This store's in-stock shelf: available listings that have a current price.
 * Products with no row here are not stocked at this store.
 */
export async function listStoreShelf(
  storeId: string,
  input?: { limit?: number; categoryId?: string | null },
): Promise<StoreShelfRow[]> {
  if (!storeId) return [];
  const limit = input?.limit ?? 60;
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, product_id')
      .eq('store_id', storeId)
      .eq('is_available', true)
      .order('updated_at', { ascending: false })
      .limit(Math.max(limit * 4, 80)),
  );
  const priceByProduct = await pricesForListings(listings);
  const productIds = [...priceByProduct.keys()];
  if (productIds.length === 0) return [];

  let products = unwrap(
    await supabase.from('products').select('*').in('id', productIds).eq('is_active', true),
  ) as Product[];
  if (input?.categoryId) {
    const ids = new Set(await categoryIdsIncludingChildren(input.categoryId));
    products = products.filter((product) => product.category_id != null && ids.has(product.category_id));
  }

  const deduped = dedupeProductsByGroup(products);
  return deduped
    .flatMap((product) => {
      const priceCents = priceByProduct.get(product.id);
      return priceCents == null ? [] : [{ product, priceCents }];
    })
    .slice(0, limit);
}

/**
 * Price in cents at one store for each product it stocks. Ids with no available
 * listing or no current price are omitted.
 */
export async function getStorePriceCentsByProductIds(
  storeId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (!storeId || unique.length === 0) return new Map();
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, product_id')
      .eq('store_id', storeId)
      .eq('is_available', true)
      .in('product_id', unique),
  );
  return pricesForListings(listings);
}

/** Product-scoped live promotions keyed by product id (and sibling group ids). */
export async function getProductPromotionMap(
  productIds?: string[],
): Promise<Map<string, Promotion>> {
  const rows = await listCurrentPromotions();
  const map = new Map<string, Promotion>();
  for (const promo of rows) {
    if (!promo.product_id) continue;
    if (!map.has(promo.product_id)) {
      map.set(promo.product_id, promo);
    }
  }
  if (!productIds?.length) return map;

  // Propagate a promo on any sibling to every requested id in that group.
  const needed = productIds.filter((id) => !map.has(id));
  await Promise.all(
    needed.map(async (id) => {
      const group = await resolveProductGroupIds(id);
      for (const sibling of group) {
        const promo = map.get(sibling);
        if (promo) {
          map.set(id, promo);
          return;
        }
      }
    }),
  );
  return map;
}

/** Short badge copy for a promotion. */
export function formatPromotionBadge(promo: Promotion): string {
  if (promo.label?.trim()) return promo.label.trim();
  if (promo.discount_type === 'percent_off') {
    return `${promo.discount_value}% off`;
  }
  if (promo.discount_type === 'amount_off') {
    const dollars = (promo.discount_value / 100).toFixed(promo.discount_value % 100 === 0 ? 0 : 2);
    return `$${dollars} off`;
  }
  const buy = promo.buy_quantity ?? 1;
  const get = promo.get_quantity ?? 1;
  if (buy === 1 && get === 1) return 'BOGO';
  return `Buy ${buy} get ${get} free`;
}

/** One-line how-it-applies for PDP (null when badge alone is enough). */
export function formatPromotionTerms(promo: Promotion): string | null {
  if (promo.discount_type === 'bogo') {
    const buy = promo.buy_quantity ?? 1;
    const get = promo.get_quantity ?? 1;
    if (buy === 1 && get === 1) return 'Buy one, get one free';
    return `Pay for ${buy}, get ${get} free`;
  }
  if (promo.discount_type === 'percent_off') {
    return `${promo.discount_value}% off the shelf price`;
  }
  if (promo.discount_type === 'amount_off') {
    const dollars = (promo.discount_value / 100).toFixed(promo.discount_value % 100 === 0 ? 0 : 2);
    return `$${dollars} off each unit`;
  }
  return null;
}

/** Synthetic promo-like badge from shelf regular vs sale price. */
export type ShelfSaleHint = {
  badge: string;
  compareAtCents: number;
  savingsLabel: string;
};

export function shelfSaleHint(
  priceCents: number | null | undefined,
  regularPriceCents: number | null | undefined,
): ShelfSaleHint | null {
  if (
    priceCents == null ||
    regularPriceCents == null ||
    regularPriceCents <= priceCents ||
    priceCents < 0
  ) {
    return null;
  }
  const save = regularPriceCents - priceCents;
  const pct = Math.round((save / regularPriceCents) * 100);
  const dollars = (save / 100).toFixed(save % 100 === 0 ? 0 : 2);
  const badge = pct >= 5 ? `${pct}% off` : `$${dollars} off`;
  return {
    badge,
    compareAtCents: regularPriceCents,
    savingsLabel: `Save $${dollars}`,
  };
}

/**
 * Cheapest shelf price + regular (when on sale) per product, expanding siblings.
 */
export async function getCheapestShelfSaleByProductIds(
  productIds: string[],
): Promise<Map<string, { priceCents: number; regularPriceCents: number | null }>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, { priceCents: number; regularPriceCents: number | null }>();
  if (unique.length === 0) return out;

  const priceMap = await getCheapestPriceCentsByProductIds(unique);
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, product_id')
      .in('product_id', unique)
      .eq('is_available', true),
  );
  if (listings.length === 0) {
    for (const [id, priceCents] of priceMap) {
      out.set(id, { priceCents, regularPriceCents: null });
    }
    return out;
  }
  const current = unwrap(
    await supabase
      .from('trusted_current_prices')
      .select('store_product_id, price_cents, regular_price_cents')
      .in(
        'store_product_id',
        listings.map((row) => row.id),
      ),
  );
  const byListing = new Map(
    current.map((row) => [
      row.store_product_id,
      {
        priceCents: row.price_cents as number,
        regularPriceCents: (row.regular_price_cents as number | null) ?? null,
      },
    ]),
  );
  for (const listing of listings) {
    const row = byListing.get(listing.id);
    if (!row) continue;
    const prior = out.get(listing.product_id);
    if (!prior || row.priceCents < prior.priceCents) {
      out.set(listing.product_id, row);
    }
  }
  for (const [id, priceCents] of priceMap) {
    if (!out.has(id)) out.set(id, { priceCents, regularPriceCents: null });
  }
  return out;
}

export type PromotionSavingsHint = {
  /** Compare-at shelf cents before the promo (when derivable). */
  compareAtCents: number | null;
  /** Short line under price, e.g. "Save $1" — null when badge alone is enough. */
  savingsLabel: string | null;
};

/**
 * Derive browse-card savings proof from a promo + displayed (post-cashback) price.
 * Pure helper — no I/O. Returns null labels when math would be misleading.
 */
export function promotionSavingsHint(
  promo: Promotion,
  priceCents: number | null | undefined,
): PromotionSavingsHint {
  if (priceCents == null || priceCents < 0) {
    return { compareAtCents: null, savingsLabel: null };
  }
  if (promo.discount_type === 'amount_off' && promo.discount_value > 0) {
    const save = promo.discount_value;
    const compareAt = priceCents + save;
    const dollars = (save / 100).toFixed(save % 100 === 0 ? 0 : 2);
    return { compareAtCents: compareAt, savingsLabel: `Save $${dollars}` };
  }
  if (promo.discount_type === 'percent_off') {
    const pct = promo.discount_value;
    if (pct > 0 && pct < 100) {
      const compareAt = Math.round(priceCents / (1 - pct / 100));
      if (compareAt > priceCents) {
        return { compareAtCents: compareAt, savingsLabel: null };
      }
    }
    return { compareAtCents: null, savingsLabel: null };
  }
  // BOGO — badge is the proof; no fake math.
  return { compareAtCents: null, savingsLabel: null };
}

/** Searches active products by name or brand. Inactive products are recalled or discontinued. */
export async function searchProducts(
  query: string,
  input?: { categoryId?: string | null; limit?: number },
): Promise<Product[]> {
  const term = safeSearch(query);
  let request = supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
    .order('name')
    .limit(input?.limit ?? 40);
  if (input?.categoryId) {
    request = request.eq('category_id', input.categoryId);
  }
  const rows = unwrap(await request);
  return diversifyProducts(rows, input?.limit ?? 40);
}

/**
 * Finds one active product by barcode. Returns null when the catalog has no row.
 * A null result means unknown, not that the barcode is unsafe.
 */
export async function findProductByUpc(upc: string): Promise<Product | null> {
  const canon = canonicalizeUpc(upc);
  if (canon) {
    const byCanon = unwrap(
      await supabase
        .from('products')
        .select('*')
        .eq('canonical_upc', canon)
        .eq('is_active', true)
        .maybeSingle(),
    );
    if (byCanon) return byCanon;
  }
  const values = upcLookupValues(upc);
  if (values.length === 0) return null;
  const rows = unwrap(
    await supabase.from('products').select('*').in('upc', values).eq('is_active', true).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Looks up a barcode in Supabase, then asks the price proxy to ingest from QFC
 * (and optionally enrich via Open Food Facts) when missing.
 */
export async function findOrIngestProductByUpc(
  upc: string,
  zip: string = CAMPUS_DEFAULT_ZIP,
): Promise<Product | null> {
  const code = upc.trim();
  if (!code) return null;
  const existing = await findProductByUpc(code);
  if (existing) return existing;

  try {
    const params = new URLSearchParams({ upc: code, zip });
    const res = await fetch(`${BACKEND_URL}/api/products/by-upc?${params}`);
    const json = (await res.json().catch(() => ({}))) as { product?: Product | null };
    if (json.product?.id) return json.product;
  } catch {
    // Fall through to a final local read.
  }
  return findProductByUpc(code);
}

type PricesProxyBody = {
  offers?: unknown[];
  safewayError?: string | null;
  fredMeyerError?: string | null;
  traderJoesError?: string | null;
  qfcError?: string | null;
};

function proxyHadRetailerError(body: PricesProxyBody | null): boolean {
  if (!body) return true;
  // Kroger-only search: ignore scrape-chain fields; allow cooldown when QFC succeeded
  // even if Fred Meyer has no nearby store for this ZIP.
  if (body.qfcError) return true;
  if (Array.isArray(body.offers) && body.offers.length > 0) return false;
  return Boolean(body.fredMeyerError || body.safewayError || body.traderJoesError);
}

/**
 * Hits the multi-store price proxy for a search term, then re-reads products.
 * Uses QFC + Fred Meyer only so search stays snappy; Safeway/TJ come from
 * scheduled bootstrap ingest. Skips when on client cooldown. Does not mark
 * cooldown if any retailer errored. Never call on bare Shop open.
 */
export async function ensureCatalogForTerm(term: string, zip: string): Promise<Product[]> {
  const query = term.trim();
  if (query.length < 2) return searchProducts(query);

  let products = await searchProducts(query);
  if (ingestOnCooldown(query, zip)) return products;

  try {
    const params = new URLSearchParams({ term: query, zip, chains: SEARCH_CHAINS });
    const res = await fetch(`${BACKEND_URL}/api/prices?${params}`);
    const body = (await res.json().catch(() => null)) as PricesProxyBody | null;
    if (!proxyHadRetailerError(body)) {
      markIngest(query, zip);
    }
  } catch {
    // Keep whatever is already in the catalog; allow retry next search.
  }
  products = await searchProducts(query);
  return products;
}

export type ProductStoreOffer = {
  storeProductId: string;
  storeId: string;
  storeName: string;
  chainName: string | null;
  priceCents: number;
  isAvailable: boolean;
  /** ISO timestamptz from trusted_current_prices.created_at */
  observedAt: string;
  /** Store accepts SNAP/EBT (from stores.accepts_snap). */
  acceptsSnap: boolean;
};

/**
 * Shelf offers for one catalog product across stores (for PDP comparisons).
 * Includes sibling product rows that share canonical UPC or fingerprint.
 * Cheapest first; one offer per store (keeps lowest price).
 */
export async function listProductStoreOffers(productId: string): Promise<ProductStoreOffer[]> {
  if (!productId) return [];

  const productIds = await resolveProductGroupIds(productId);

  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, store_id, is_available, product_id')
      .in('product_id', productIds),
  );
  if (listings.length === 0) return [];

  const storeIds = [...new Set(listings.map((row) => row.store_id))];
  const stores = unwrap(
    await supabase
      .from('stores')
      .select('id, name, chain_id, accepts_snap')
      .in('id', storeIds),
  );
  const chainIds = [...new Set(stores.map((row) => row.chain_id).filter(Boolean))] as string[];
  const chains =
    chainIds.length === 0
      ? []
      : unwrap(await supabase.from('chains').select('id, name').in('id', chainIds));
  const storeById = new Map(stores.map((row) => [row.id, row]));
  const chainById = new Map(chains.map((row) => [row.id, row.name]));

  const prices = unwrap(
    await supabase
      .from('trusted_current_prices')
      .select('store_product_id, price_cents, created_at')
      .in(
        'store_product_id',
        listings.map((row) => row.id),
      ),
  );
  const priceByListing = new Map(
    prices.map((row) => [
      row.store_product_id,
      { priceCents: row.price_cents, observedAt: row.created_at as string },
    ]),
  );

  const byStore = new Map<string, ProductStoreOffer>();
  for (const listing of listings) {
    const price = priceByListing.get(listing.id);
    if (price == null) continue;
    const store = storeById.get(listing.store_id);
    const offer: ProductStoreOffer = {
      storeProductId: listing.id,
      storeId: listing.store_id,
      storeName: store?.name ?? 'Store',
      chainName: store?.chain_id ? (chainById.get(store.chain_id) ?? null) : null,
      priceCents: price.priceCents,
      isAvailable: listing.is_available,
      observedAt: price.observedAt,
      acceptsSnap: Boolean(store?.accepts_snap),
    };
    const existing = byStore.get(listing.store_id);
    if (!existing || offer.priceCents < existing.priceCents) {
      byStore.set(listing.store_id, offer);
    }
  }

  return [...byStore.values()].sort((a, b) => a.priceCents - b.priceCents);
}

function offersNeedDayRefresh(offers: ProductStoreOffer[]): boolean {
  if (offers.length === 0) return true;
  return offers.some((offer) => offer.observedAt && isPriorLocalCalendarDay(offer.observedAt));
}

function openPricesAsOffers(rows: OpenPriceRow[]): ProductStoreOffer[] {
  return rows
    .filter((row) => Number.isInteger(row.priceCents) && (row.priceCents ?? 0) > 0)
    .slice(0, 5)
    .map((row, index) => ({
      storeProductId: `open-prices:${index}`,
      storeId: 'open-prices',
      storeName: [row.storeName, row.city].filter(Boolean).join(' · ') || 'Community store',
      chainName: 'Community (Open Prices)',
      priceCents: row.priceCents as number,
      isAvailable: true,
      observedAt: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
      acceptsSnap: false,
    }));
}

/**
 * Refreshes multi-store shelf prices for one product, then returns updated offers.
 * Uses UPC as the search term when present so chains can match the same SKU.
 * Bypasses the short cooldown when any offer is from a prior local calendar day.
 * When retailer coverage is thin, appends Open Prices rows by UPC (display-only).
 */
export async function refreshProductStoreOffers(
  product: Pick<Product, 'id' | 'name' | 'upc'>,
  zip: string,
): Promise<ProductStoreOffer[]> {
  if (!product?.id) return [];
  const term = String(product.upc ?? '').trim() || product.name.trim();
  const existing = await listProductStoreOffers(product.id);
  const dayStale = offersNeedDayRefresh(existing);
  const shouldFetch =
    term.length >= 2 && (dayStale || !ingestOnCooldown(term, zip));

  if (shouldFetch) {
    try {
      // PDP: Kroger APIs first for speed; scrapes already in catalog from bootstrap.
      const params = new URLSearchParams({ term, zip, chains: SEARCH_CHAINS });
      const res = await fetch(`${BACKEND_URL}/api/prices?${params}`);
      const body = (await res.json().catch(() => null)) as PricesProxyBody | null;
      if (!proxyHadRetailerError(body)) {
        markIngest(term, zip);
      }
    } catch {
      // Return whatever is already persisted for this product.
    }
  }

  let offers = await listProductStoreOffers(product.id);
  const upc = String(product.upc ?? '').replace(/\D/g, '');
  if (offers.length < 2 && /^\d{8,14}$/.test(upc)) {
    // Day-cache + live Open Prices (USD preferred) when retailer coverage is thin.
    const openByUpc = await getOpenPricesCentsByUpcs([upc]);
    const cents = openByUpc.get(upc);
    const crowd =
      cents != null
        ? openPricesAsOffers([
            {
              priceCents: cents,
              currency: 'USD',
              date: null,
              storeName: 'Community store',
              city: null,
              source: 'open_prices',
            },
          ])
        : [];
    if (crowd.length > 0) {
      const retailerStores = new Set(offers.map((o) => o.storeId));
      offers = [
        ...offers,
        ...crowd.filter((row) => !retailerStores.has(row.storeId)),
      ].sort((a, b) => a.priceCents - b.priceCents);
    }
  }
  return offers;
}

/**
 * Recently priced products for the “Popular on campus” carousel when the
 * shopper has no personal staples yet.
 */
export async function listCampusPopularProducts(input?: { limit?: number }): Promise<Product[]> {
  const limit = input?.limit ?? 12;
  const prices = unwrap(
    await supabase
      .from('prices')
      .select('store_product_id, created_at')
      .order('created_at', { ascending: false })
      .limit(80),
  );
  if (prices.length === 0) {
    return listActiveProducts({ limit });
  }

  const storeProductIds = [...new Set(prices.map((row) => row.store_product_id))];
  const listings = unwrap(
    await supabase.from('store_products').select('id, product_id').in('id', storeProductIds),
  );
  const productIdByListing = new Map(listings.map((row) => [row.id, row.product_id]));
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const price of prices) {
    const productId = productIdByListing.get(price.store_product_id);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    orderedIds.push(productId);
    if (orderedIds.length >= limit) break;
  }
  if (orderedIds.length === 0) {
    return listActiveProducts({ limit });
  }
  return getProductsByIds(orderedIds);
}

/**
 * Stores within radiusKm of a coordinate, nearest first. Stores without
 * coordinates, or with no available priced item, are omitted.
 */
export async function nearbyShops(input: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
}): Promise<NearbyStore[]> {
  return unwrap(
    await supabase.rpc('nearby_shops', {
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_radius_km: input.radiusKm ?? 25,
    }),
  );
}

/** One store, including its street address. */
export async function getStore(storeId: string): Promise<Store> {
  return unwrapOne(
    await supabase.from('stores').select('*').eq('id', storeId).maybeSingle(),
    'Store not found.',
  );
}

function safeSearch(query: string): string {
  return query.replace(/[%_,]/g, ' ').trim();
}

/** The newest shelf price for one store listing. Null when nobody has observed a price. */
export async function getCurrentPrice(storeProductId: string): Promise<CurrentPrice | null> {
  return unwrap(
    await supabase
      .from('current_prices')
      .select('*')
      .eq('store_product_id', storeProductId)
      .maybeSingle(),
  );
}

/** Promotions that have not ended. Filter further by store, chain, or date in the screen. */
export async function listCurrentPromotions(): Promise<Promotion[]> {
  const pageSize = 500;
  const rows = unwrap(
    await supabase
      .from('promotions')
      .select('*')
      .gt('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: true })
      .limit(pageSize),
  );
  return rows;
}

/** Every store a signed-in user may attach a shelf-price report to. */
export async function listReportableStores(): Promise<ReportableStore[]> {
  return unwrap(await supabase.rpc('list_reportable_stores'));
}

/**
 * Saves a Trader Joe's or campus store for later price reports.
 * kind is `trader_joes` or `campus`. A campus store requires collegeName.
 * The same name and ZIP return the existing store. Scraped QFC, Safeway,
 * Fred Meyer, and Trader Joe's stores already exist from the price proxy.
 */
export async function registerReportableStore(input: {
  name: string;
  kind: 'trader_joes' | 'campus';
  collegeName?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}): Promise<string> {
  return unwrap(
    await supabase.rpc('register_reportable_store', {
      p_name: input.name,
      p_kind: input.kind,
      p_college_name: input.collegeName ?? null,
      p_address_line1: input.addressLine1 ?? null,
      p_city: input.city ?? null,
      p_region: input.region ?? null,
      p_postal_code: input.postalCode ?? null,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null,
    }),
  );
}

export type ReportedOffer = {
  store: string;
  name: string;
  brand: string | null;
  priceCents: number;
  source: 'user_report';
};

/**
 * Latest user_report shelf prices whose product name matches, at any store.
 * Ignores api/scrape observations so manual reports stay the trusted source.
 * Returns an empty list when nobody is signed in.
 */
export async function listReportedOffers(term: string): Promise<ReportedOffer[]> {
  const user = await supabase.auth.getUser();
  if (!user.data.user) return [];
  const products = await searchProducts(term);
  if (products.length === 0) return [];
  const stores = await listReportableStores();
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, store_id, product_id')
      .in(
        'product_id',
        products.map((product) => product.id),
      ),
  );
  const relevant = listings.filter((listing) => storeNames.has(listing.store_id));
  if (relevant.length === 0) return [];
  const prices = unwrap(
    await supabase
      .from('prices')
      .select('store_product_id, price_cents, created_at')
      .eq('source', 'user_report')
      .in(
        'store_product_id',
        relevant.map((listing) => listing.id),
      )
      .order('created_at', { ascending: false }),
  );
  const priceByListing = new Map<string, number>();
  for (const price of prices) {
    if (!priceByListing.has(price.store_product_id)) {
      priceByListing.set(price.store_product_id, price.price_cents);
    }
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  return relevant.flatMap((listing) => {
    const priceCents = priceByListing.get(listing.id);
    const product = productById.get(listing.product_id);
    if (priceCents == null || !product) return [];
    return [
      {
        store: storeNames.get(listing.store_id) ?? 'Reported store',
        name: product.name,
        brand: product.brand,
        priceCents,
        source: 'user_report' as const,
      },
    ];
  });
}

/**
 * Uploads a shelf-tag photo to price-evidence/<user id>/<uuid>.ext.
 * Pass the returned path to reportManualPrice as evidencePath.
 */
export async function uploadPriceEvidence(input: {
  data: ArrayBuffer;
  contentType: string;
}): Promise<string> {
  const user = await supabase.auth.getUser();
  if (!user.data.user) fail('Sign in before uploading a price photo.');
  const ext =
    input.contentType.includes('png') ? 'png'
    : input.contentType.includes('webp') ? 'webp'
    : 'jpg';
  const path = `${user.data.user.id}/${Crypto.randomUUID()}.${ext}`;
  const uploaded = await supabase.storage.from('price-evidence').upload(path, input.data, {
    contentType: input.contentType,
    upsert: false,
  });
  if (uploaded.error) fail(uploaded.error, 'Could not upload the shelf photo.');
  return path;
}

/**
 * Appends a student-reported shelf price in cents at any store.
 * Creates the product and the store listing when they do not exist yet.
 * Manual reports override automated api/scrape prices for that listing.
 * Optional evidencePath is a price-evidence Storage object under the caller.
 */
export async function reportManualPrice(input: {
  storeId: string;
  productName: string;
  priceCents: number;
  brand?: string;
  upc?: string;
  evidencePath?: string;
}): Promise<string> {
  const storeProductId = unwrap(
    await supabase.rpc('report_manual_price', {
      p_store_id: input.storeId,
      p_product_name: input.productName,
      p_price_cents: input.priceCents,
      p_brand: input.brand ?? null,
      p_upc: input.upc ?? null,
      p_evidence_path: input.evidencePath ?? null,
    }),
  );

  // Best-effort contribute to Open Prices when credentials are configured.
  void (async () => {
    try {
      const store = await getStore(input.storeId).catch(() => null);
      await contributeReportedPriceToOpenPrices({
        upc: input.upc,
        priceCents: input.priceCents,
        storeName: store?.name ?? null,
        latitude: store?.latitude ?? null,
        longitude: store?.longitude ?? null,
      });
    } catch {
      // ignore
    }
  })();

  return storeProductId;
}

/**
 * Marks a store listing in or out of stock. Signed-in students only.
 */
export async function reportStoreProductAvailability(input: {
  storeProductId: string;
  isAvailable: boolean;
}): Promise<void> {
  unwrapVoid(
    await supabase.rpc('report_store_product_availability', {
      p_store_product_id: input.storeProductId,
      p_is_available: input.isAvailable,
    }),
  );
}

/**
 * Appends a student-reported shelf price in cents. Prices are never edited.
 * submitted_by must be the signed-in user, which this function sets.
 * The store listing must already exist. reportManualPrice creates that listing
 * for any store when needed.
 */
export async function reportPrice(input: {
  storeProductId: string;
  priceCents: number;
}): Promise<Price> {
  const user = await supabase.auth.getUser();
  if (!user.data.user) fail('Sign in before reporting a price.');
  const price = unwrapOne<Price>(
    await supabase
      .from('prices')
      .insert({
        store_product_id: input.storeProductId,
        price_cents: input.priceCents,
        source: 'user_report',
        submitted_by: user.data.user.id,
      })
      .select('*')
      .maybeSingle(),
    'Price report did not return a row.',
  );

  void (async () => {
    try {
      const listing = unwrapOne<{ store_id: string; product_id: string }>(
        await supabase
          .from('store_products')
          .select('store_id, product_id')
          .eq('id', input.storeProductId)
          .maybeSingle(),
        'Listing missing.',
      );
      const [product, store] = await Promise.all([
        supabase.from('products').select('upc').eq('id', listing.product_id).maybeSingle(),
        getStore(listing.store_id).catch(() => null),
      ]);
      await contributeReportedPriceToOpenPrices({
        upc: product.data?.upc,
        priceCents: input.priceCents,
        storeName: store?.name ?? null,
        latitude: store?.latitude ?? null,
        longitude: store?.longitude ?? null,
      });
    } catch {
      // ignore
    }
  })();

  return price;
}

/**
 * Product trait warnings for the signed-in user's rules. This reads only the
 * caller's rules and the public product traits. It does not reveal another
 * member's rules; group planning does that inside the database function.
 */
export async function productWarnings(productId: string): Promise<
  { traitName: string; relation: string; mode: string }[]
> {
  const rules = unwrap(await supabase.from('user_food_rules').select('trait_id, mode'));
  const traits = unwrap(
    await supabase.from('product_traits').select('trait_id, relation').eq('product_id', productId),
  );
  const catalog = unwrap(await supabase.from('food_traits').select('id, name'));
  const names = new Map(catalog.map((trait) => [trait.id, trait.name]));
  return traits.flatMap((trait) => {
    const rule = rules.find((candidate) => candidate.trait_id === trait.trait_id);
    if (!rule) return [];
    const conflicts =
      (rule.mode === 'avoid' && (trait.relation === 'contains' || trait.relation === 'may_contain')) ||
      (rule.mode === 'require' && trait.relation !== 'suitable' && trait.relation !== 'certified');
    if (!conflicts) return [];
    return [{ traitName: names.get(trait.trait_id) ?? 'Unknown trait', relation: trait.relation, mode: rule.mode }];
  });
}
