import type {
  CurrentPrice,
  NearbyStore,
  Price,
  Product,
  ProductCategory,
  Promotion,
  ReportableStore,
  Store,
} from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne } from './query';

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
 * Stores within radiusKm of a coordinate, nearest first. Stores without
 * latitude and longitude are omitted.
 */
export async function nearbyStores(input: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
}): Promise<NearbyStore[]> {
  return unwrap(
    await supabase.rpc('nearby_stores', {
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

/** Trader Joe's stores and campus stores, which are the only places a user can report a shelf price. */
export async function listReportableStores(): Promise<ReportableStore[]> {
  return unwrap(await supabase.rpc('list_reportable_stores'));
}

/**
 * Saves a Trader Joe's or campus store for later price reports.
 * kind is `trader_joes` or `campus`. A campus store requires collegeName.
 * The same name and ZIP return the existing store.
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
 * Saved shelf prices at Trader Joe's and campus stores whose product name matches.
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
      .from('current_prices')
      .select('store_product_id, price_cents')
      .in(
        'store_product_id',
        relevant.map((listing) => listing.id),
      ),
  );
  const priceByListing = new Map(prices.map((price) => [price.store_product_id, price.price_cents]));
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
 * Appends a student-reported shelf price in cents at a Trader Joe's or campus store.
 * Creates the product and the store listing when they do not exist yet.
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
 * The store listing must already exist. For Trader Joe's and campus stores,
 * reportManualPrice creates that listing.
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
