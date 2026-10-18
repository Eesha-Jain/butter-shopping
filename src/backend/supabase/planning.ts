import type { PriceOption, Profile, ShoppingPlanLine } from '../types';
import { searchShelfPrices } from '../../api/prices';
import { fail } from '../errors';
import { supabase } from './client';
import { nextPreferredGroceryDate } from './dates';
import { listResolvedItems } from './lists';
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

/**
 * Searches every open list item so live and reported prices are stored, then
 * returns the cheapest trip from recommendShoppingPlan. Sum line_cents for the
 * total. A null store_product_id means that item has no usable price.
 */
export async function planLowestTrip(input: {
  listId: string;
  plannedFor: string;
  zip: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<ShoppingPlanLine[]> {
  const items = await listResolvedItems(input.listId);
  for (const item of items) {
    if (item.done_at || !item.display_name) continue;
    await searchShelfPrices({ term: item.display_name, zip: input.zip });
  }
  return recommendShoppingPlan({
    listId: input.listId,
    plannedFor: input.plannedFor,
    latitude: input.latitude,
    longitude: input.longitude,
  });
}

/**
 * The next date in the coming two months when the caller's opted-in basket
 * discounts are largest at a Washington store. Null when none apply.
 * Pass this to recommendShoppingPlan instead of a weekday-only preference.
 */
export async function suggestDiscountDate(input?: {
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number;
}): Promise<string | null> {
  const result = await supabase.rpc('recommend_discount_date', {
    p_latitude: input?.latitude ?? null,
    p_longitude: input?.longitude ?? null,
    p_radius_km: input?.radiusKm ?? 25,
  });
  if (result.error) fail(result.error, 'Could not choose a discount date.');
  return result.data;
}

export type ShopDayReason = 'shelf_pattern' | 'promotion' | 'preferred' | 'default';

export type ShopDayStoreHint = {
  store_id: string;
  name: string;
  best_dow: number;
  relative_index: number;
  obs_count: number;
};

export type BestShopDay = {
  shopOn: string;
  reason: ShopDayReason;
  score: number;
  stores: ShopDayStoreHint[];
  /** Short copy for List / Agent, e.g. why this day was chosen. */
  reasonLabel: string;
};

function shopDayReasonLabel(reason: ShopDayReason, stores: ShopDayStoreHint[]): string {
  if (reason === 'promotion') return 'Best nearby basket discounts land on this day.';
  if (reason === 'shelf_pattern') {
    const top = stores[0];
    if (top?.name) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dow = days[top.best_dow] ?? 'this weekday';
      return `${top.name} tends lower on ${dow}s (${top.obs_count} price checks).`;
    }
    return 'Nearby stores tend to be cheaper on this weekday.';
  }
  if (reason === 'preferred') return 'Matches your preferred grocery day.';
  return 'Next open shopping day.';
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * History-aware grocery day. Uses the cheapest day of the past week when that
 * history exists, then the longer weekday pattern. Pass shopOn to recommendShoppingPlan.
 */

export async function suggestBestShopDate(input?: {
  postalCode?: string;
  from?: string;
  listId?: string;
}): Promise<BestShopDay> {
  const week = await supabase.rpc('best_week_price_day', {
    p_list_id: input?.listId ?? null,
    p_near_postal_code: input?.postalCode ?? '98195',
  });
  const weekDay = week.data;
  if (!week.error && weekDay?.shop_on) {
    const dow = typeof weekDay.dow === 'number' ? weekDay.dow : null;
    const weekday = dow != null && WEEKDAY_NAMES[dow] ? WEEKDAY_NAMES[dow] : 'that day';
    return {
      shopOn: weekDay.shop_on,
      reason: 'shelf_pattern',
      score: typeof weekDay.total_cents === 'number' ? weekDay.total_cents : 0,
      stores: [],
      reasonLabel: `Prices from the past week were lowest on ${weekday}.`,
    };
  }

  const result = await supabase.rpc('recommend_shop_day', {
    p_near_postal_code: input?.postalCode ?? '98195',
    p_from: input?.from ?? null,
  });
  if (result.error) fail(result.error, 'Could not choose a shopping day.');
  const raw = result.data as {
    shop_on?: string;
    reason?: string;
    score?: number;
    stores?: ShopDayStoreHint[];
  } | null;
  const reason = (raw?.reason ?? 'default') as ShopDayReason;
  const stores = Array.isArray(raw?.stores) ? raw.stores : [];
  const shopOn =
    typeof raw?.shop_on === 'string' && raw.shop_on
      ? raw.shop_on
      : await suggestGroceryDate();
  return {
    shopOn,
    reason,
    score: typeof raw?.score === 'number' ? raw.score : 0,
    stores,
    reasonLabel: shopDayReasonLabel(reason, stores),
  };
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
