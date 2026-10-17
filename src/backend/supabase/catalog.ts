import type {
  CurrentPrice,
  NearbyStore,
  Price,
  Product,
  ProductCategory,
  Promotion,
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

/**
 * Appends a student-reported shelf price in cents. Prices are never edited.
 * submitted_by must be the signed-in user, which this function sets.
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
