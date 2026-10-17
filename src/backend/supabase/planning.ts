import type { PriceOption, Profile, ShoppingPlanLine } from '../types';
import { supabase } from './client';
import { nextPreferredGroceryDate } from './dates';
import { unwrap, unwrapOne } from './query';

/**
 * The next calendar date to shop. Uses the device's local weekday and the
 * profile's preferred_days, where 0 is Sunday. Pass the result to
 * recommendShoppingPlan as plannedFor.
 */
export async function suggestGroceryDate(profile?: Profile): Promise<string> {
  if (profile) return nextPreferredGroceryDate(profile.preferred_days);
  const user = await supabase.auth.getUser();
  const current = unwrapOne<Profile>(
    await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.data.user?.id ?? '')
      .maybeSingle(),
    'Profile not found.',
  );
  return nextPreferredGroceryDate(current.preferred_days);
}

/**
 * Every legal offer for one product or category on a date. Pass the group id
 * so the strictest member rule is applied without returning those private rules.
 * Read line_cents for the estimated promotional total and shelf_price_cents for
 * the observed sticker price. Prefer effective_cents_per_base when ranking:
 * it divides line_cents by how much of the pack the group can finish before
 * spoil (habits, else amount_base / 7 days).
 */
export async function priceOptions(input: {
  groupId: string;
  plannedFor: string;
  productId?: string;
  categoryId?: string;
  quantity?: number;
  amountBase?: number | null;
  sizeFlexible?: boolean;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<PriceOption[]> {
  return unwrap(
    await supabase.rpc('price_options', {
      p_group_id: input.groupId,
      p_category_id: input.categoryId ?? null,
      p_product_id: input.productId ?? null,
      p_planned_for: input.plannedFor,
      p_quantity: input.quantity ?? 1,
      p_amount_base: input.amountBase ?? null,
      p_size_flexible: input.sizeFlexible ?? true,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null,
    }),
  );
}

/**
 * One recommended line per unchecked list item. The trip date is plannedFor;
 * choose it with suggestGroceryDate when the user has preferred days. Picks use
 * waste-adjusted effective_cents_per_base (then line_cents, then distance). A
 * null store_product_id means that item cannot be ordered yet. over_budget is
 * the same on every row and still compares sum(line_cents) with weekly_budget_cents.
 */
export async function recommendShoppingPlan(input: {
  listId: string;
  plannedFor: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<ShoppingPlanLine[]> {
  return unwrap(
    await supabase.rpc('recommend_shopping_plan', {
      p_list_id: input.listId,
      p_planned_for: input.plannedFor,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null,
    }),
  );
}

/** The caller's weekly target, in cents. Null means no target has been set. */
export async function getWeeklyBudgetCents(): Promise<number | null> {
  const user = await supabase.auth.getUser();
  const profile = unwrapOne<Pick<Profile, 'weekly_budget_cents'>>(
    await supabase
      .from('profiles')
      .select('weekly_budget_cents')
      .eq('id', user.data.user?.id ?? '')
      .maybeSingle(),
    'Profile not found.',
  );
  return profile.weekly_budget_cents;
}
