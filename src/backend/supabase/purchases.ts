import type { ExpiringPurchase, ItemHabit, Purchase } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne } from './query';

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
