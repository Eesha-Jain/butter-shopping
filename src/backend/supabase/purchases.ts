import type { ExpiringPurchase, ItemHabit, Purchase } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { todayLocalDateKey } from './localTime';
import { unwrap, unwrapOne } from './query';

export type ActivePantryItem = {
  categoryId: string | null;
  productId: string;
  productName: string;
  purchasedAt: string;
  expiresOn: string | null;
};

/**
 * Receipt lines for a group, newest first. user_id is the person who paid,
 * not a record of who consumed the food. Rows are immutable.
 */
export async function listPurchases(groupId: string): Promise<Purchase[]> {
  return unwrap(
    await supabase
      .from('purchases')
      .select('*')
      .eq('group_id', groupId)
      .order('purchased_at', { ascending: false }),
  );
}

/**
 * Records an in-store purchase. The caller is stored as the payer. expiresOn
 * can be set only now; there is no later update. When omitted, the database
 * defaults expires_on from product/category shelf life. Do not use this for an
 * order placed in the app, because finalizeOrder already writes those purchases.
 */
export async function recordPurchase(input: {
  groupId: string;
  storeProductId: string;
  quantity: number;
  unitPriceCents: number;
  expiresOn?: string | null;
  purchasedAt?: string | null;
}): Promise<string> {
  return unwrap(
    await supabase.rpc('record_purchase', {
      p_group_id: input.groupId,
      p_store_product_id: input.storeProductId,
      p_quantity: input.quantity,
      p_unit_price_cents: input.unitPriceCents,
      p_expires_on: input.expiresOn ?? null,
      p_purchased_at: input.purchasedAt ?? null,
    }),
  );
}

/**
 * Usage habits for a group. A habit is shared by the household or party.
 * Set exactly one of productId or categoryId. usualAmountBase uses that
 * category's g, ml, or ct unit. intervalDays is how long one purchase lasts.
 */
export async function listHabits(groupId: string): Promise<ItemHabit[]> {
  return unwrap(await supabase.from('item_habits').select('*').eq('group_id', groupId));
}

/**
 * Product ids the household often buys: habit product targets first, then
 * recent purchase product ids when habits are sparse. Max 20.
 */
export async function listMyStapleProductIds(groupId: string): Promise<string[]> {
  const habits = await listHabits(groupId);
  const fromHabits = habits
    .map((habit) => habit.product_id)
    .filter((id): id is string => Boolean(id));

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of fromHabits) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  if (ordered.length >= 12) {
    return ordered.slice(0, 20);
  }

  const purchases = await listPurchases(groupId);
  const recent = purchases.slice(0, 40);
  if (recent.length === 0) return ordered.slice(0, 20);

  const storeProductIds = [...new Set(recent.map((row) => row.store_product_id))];
  const listings = unwrap(
    await supabase.from('store_products').select('id, product_id').in('id', storeProductIds),
  );
  const productByStoreProduct = new Map(listings.map((row) => [row.id, row.product_id]));
  for (const purchase of recent) {
    const productId = productByStoreProduct.get(purchase.store_product_id);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    ordered.push(productId);
    if (ordered.length >= 20) break;
  }
  return ordered;
}

/** Creates or replaces the group's habit for one product or one category. */
export async function saveHabit(input: {
  groupId: string;
  productId?: string;
  categoryId?: string;
  intervalDays: number;
  usualAmountBase?: number;
  nextDueOn: string;
  autoAddEnabled?: boolean;
}): Promise<ItemHabit> {
  if (Boolean(input.productId) === Boolean(input.categoryId)) {
    fail('A habit needs exactly one of a product or a category.');
  }
  const existingQuery = supabase
    .from('item_habits')
    .select('*')
    .eq('group_id', input.groupId);
  const existing = unwrap(
    await (input.productId
      ? existingQuery.eq('product_id', input.productId)
      : existingQuery.eq('category_id', input.categoryId ?? '')
    ).maybeSingle(),
  );
  const row = {
    group_id: input.groupId,
    product_id: input.productId ?? null,
    category_id: input.categoryId ?? null,
    interval_days: input.intervalDays,
    usual_amount_base: input.usualAmountBase ?? null,
    next_due_on: input.nextDueOn,
    auto_add_enabled: input.autoAddEnabled ?? true,
    source: 'user' as const,
  };
  if (existing) {
    return unwrapOne(
      await supabase.from('item_habits').update(row).eq('id', existing.id).select('*').maybeSingle(),
      'Habit update did not return a row.',
    );
  }
  return unwrapOne(
    await supabase.from('item_habits').insert(row).select('*').maybeSingle(),
    'Habit insert did not return a row.',
  );
}

/**
 * Adds due habits to the caller's default lists and returns how many list rows
 * were inserted. The scheduled job does this for every group; a signed-in
 * caller can run it for their own groups.
 */
export async function addDueHabitItems(): Promise<number> {
  return unwrap(await supabase.rpc('add_due_habit_items'));
}

/**
 * Purchases expiring today, tomorrow, or in two days. The push job sends only
 * for the two-day mark so a daily run does not repeat the same reminder.
 */
export async function listExpiringPurchases(groupId: string): Promise<ExpiringPurchase[]> {
  return unwrap(await supabase.from('v_expiring_purchases').select('*').eq('group_id', groupId));
}

/**
 * Household purchases that are still usable: expires_on is null (unknown) or
 * on/after today. Used to caution recipe→list adds.
 */
export async function listActivePantryItems(groupId: string): Promise<ActivePantryItem[]> {
  const purchases = await listPurchases(groupId);
  const today = todayLocalDateKey();
  const active = purchases.filter(
    (row) => row.expires_on == null || row.expires_on >= today,
  );
  if (active.length === 0) return [];

  const storeProductIds = [...new Set(active.map((row) => row.store_product_id))];
  const listings = unwrap(
    await supabase
      .from('store_products')
      .select('id, product_id')
      .in('id', storeProductIds),
  );
  const productIdByListing = new Map(listings.map((row) => [row.id, row.product_id]));
  const productIds = [...new Set(listings.map((row) => row.product_id))];
  if (productIds.length === 0) return [];

  const products = unwrap(
    await supabase
      .from('products')
      .select('id, name, category_id')
      .in('id', productIds),
  );
  const productById = new Map(products.map((row) => [row.id, row]));

  const out: ActivePantryItem[] = [];
  for (const purchase of active) {
    const productId = productIdByListing.get(purchase.store_product_id);
    if (!productId) continue;
    const product = productById.get(productId);
    if (!product) continue;
    out.push({
      categoryId: product.category_id,
      productId: product.id,
      productName: product.name,
      purchasedAt: purchase.purchased_at,
      expiresOn: purchase.expires_on,
    });
  }
  return out;
}
