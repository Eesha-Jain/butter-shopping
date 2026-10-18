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
import { unwrap, unwrapOne } from './query';

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

/** Top-level shopping categories (parent_id is null), ordered by name. */
export async function listCategories(input?: { limit?: number }): Promise<ProductCategory[]> {
  return unwrap(
    await supabase
      .from('product_categories')
      .select('*')
      .is('parent_id', null)
      .order('name')
      .limit(input?.limit ?? 50),
  );
}

/** Active catalog products for browse. Optional category filter. */
export async function listActiveProducts(input?: {
  limit?: number;
  categoryId?: string | null;
}): Promise<Product[]> {
  let query = supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('name')
    .limit(input?.limit ?? 60);
  if (input?.categoryId) {
    query = query.eq('category_id', input.categoryId);
  }
  return unwrap(await query);
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
 * Missing ids mean no observed price yet.
 */
export async function getCheapestPriceCentsByProductIds(
  productIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const prices = new Map<string, number>();
  if (unique.length === 0) return prices;

  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, product_id')
      .in('product_id', unique)
      .eq('is_available', true),
  );
  if (listings.length === 0) return prices;

  const storeProductIds = listings.map((row) => row.id);
  const current = unwrap(
    await supabase.from('current_prices').select('store_product_id, price_cents').in('store_product_id', storeProductIds),
  );
  const priceByStoreProduct = new Map(current.map((row) => [row.store_product_id, row.price_cents]));
  for (const listing of listings) {
    const cents = priceByStoreProduct.get(listing.id);
    if (cents == null) continue;
    const prior = prices.get(listing.product_id);
    if (prior == null || cents < prior) {
      prices.set(listing.product_id, cents);
    }
  }
  return prices;
}

/** Product-scoped live promotions keyed by product id. */
export async function getProductPromotionMap(): Promise<Map<string, Promotion>> {
  const rows = await listCurrentPromotions();
  const map = new Map<string, Promotion>();
  for (const promo of rows) {
    if (!promo.product_id) continue;
    if (!map.has(promo.product_id)) {
      map.set(promo.product_id, promo);
    }
  }
  return map;
}

/** Short badge copy for a promotion. */
export function formatPromotionBadge(promo: Promotion): string {
  if (promo.discount_type === 'percent_off') {
    return `${promo.discount_value}% off`;
  }
  if (promo.discount_type === 'amount_off') {
    const dollars = (promo.discount_value / 100).toFixed(promo.discount_value % 100 === 0 ? 0 : 2);
    return `$${dollars} off`;
  }
  return 'BOGO';
}

/** Searches active products by name or brand. Inactive products are recalled or discontinued. */
export async function searchProducts(query: string): Promise<Product[]> {
  const term = safeSearch(query);
  return unwrap(
    await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
      .limit(30),
  );
}

/**
 * Finds one active product by barcode. Returns null when the catalog has no row.
 * A null result means unknown, not that the barcode is unsafe.
 */
export async function findProductByUpc(upc: string): Promise<Product | null> {
  return unwrap(
    await supabase.from('products').select('*').eq('upc', upc).eq('is_active', true).maybeSingle(),
  );
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
  safewayError?: string | null;
  fredMeyerError?: string | null;
  traderJoesError?: string | null;
  qfcError?: string | null;
};

function proxyHadRetailerError(body: PricesProxyBody | null): boolean {
  if (!body) return true;
  return Boolean(body.safewayError || body.fredMeyerError || body.traderJoesError || body.qfcError);
}

/**
 * Hits the multi-store price proxy for a search term, then re-reads products.
 * Skips when on client cooldown. Does not mark cooldown if any retailer errored,
 * so partial (e.g. QFC-only) failures can retry. Never call on bare Shop open.
 */
export async function ensureCatalogForTerm(term: string, zip: string): Promise<Product[]> {
  const query = term.trim();
  if (query.length < 2) return searchProducts(query);

  let products = await searchProducts(query);
  if (ingestOnCooldown(query, zip)) return products;

  try {
    const params = new URLSearchParams({ term: query, zip });
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
  /** ISO timestamptz from current_prices.created_at */
  observedAt: string;
};

/**
 * Shelf offers for one catalog product across stores (for PDP comparisons).
 * Cheapest first. Empty when no listings/prices exist yet.
 */
export async function listProductStoreOffers(productId: string): Promise<ProductStoreOffer[]> {
  if (!productId) return [];
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, store_id, is_available')
      .eq('product_id', productId),
  );
  if (listings.length === 0) return [];

  const storeIds = [...new Set(listings.map((row) => row.store_id))];
  const stores = unwrap(
    await supabase.from('stores').select('id, name, chain_id').in('id', storeIds),
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
      .from('current_prices')
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

  const offers = listings.flatMap((listing) => {
    const price = priceByListing.get(listing.id);
    if (price == null) return [];
    const store = storeById.get(listing.store_id);
    return [
      {
        storeProductId: listing.id,
        storeId: listing.store_id,
        storeName: store?.name ?? 'Store',
        chainName: store?.chain_id ? (chainById.get(store.chain_id) ?? null) : null,
        priceCents: price.priceCents,
        isAvailable: listing.is_available,
        observedAt: price.observedAt,
      },
    ];
  });

  return offers.sort((a, b) => a.priceCents - b.priceCents);
}

function offersNeedDayRefresh(offers: ProductStoreOffer[]): boolean {
  if (offers.length === 0) return true;
  return offers.some((offer) => offer.observedAt && isPriorLocalCalendarDay(offer.observedAt));
}

/**
 * Refreshes multi-store shelf prices for one product, then returns updated offers.
 * Uses UPC as the search term when present so chains can match the same SKU.
 * Bypasses the short cooldown when any offer is from a prior local calendar day.
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
      const params = new URLSearchParams({ term, zip });
      const res = await fetch(`${BACKEND_URL}/api/prices?${params}`);
      const body = (await res.json().catch(() => null)) as PricesProxyBody | null;
      if (!proxyHadRetailerError(body)) {
        markIngest(term, zip);
      }
    } catch {
      // Return whatever is already persisted for this product.
    }
  }
  return listProductStoreOffers(product.id);
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
 * latitude and longitude are omitted.
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
  return unwrap(
    await supabase.from('promotions').select('*').gt('ends_at', new Date().toISOString()).limit(100),
  );
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
 * Appends a student-reported shelf price in cents at any store.
 * Creates the product and the store listing when they do not exist yet.
 * Manual reports override automated api/scrape prices for that listing.
 */
export async function reportManualPrice(input: {
  storeId: string;
  productName: string;
  priceCents: number;
  brand?: string;
  upc?: string;
}): Promise<string> {
  return unwrap(
    await supabase.rpc('report_manual_price', {
      p_store_id: input.storeId,
      p_product_name: input.productName,
      p_price_cents: input.priceCents,
      p_brand: input.brand ?? null,
      p_upc: input.upc ?? null,
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
  return unwrapOne(
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
