import type {
  FulfillmentMethod,
  Order,
  OrderItem,
  OrderShare,
  OrderSummary,
  ShoppingTrip,
  TripStatus,
} from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { evenShareCents, payerRemainderCents } from './money';
import { unwrap, unwrapOne, unwrapVoid } from './query';

export type GroupOrderRow = OrderSummary & {
  store_name: string;
};

/**
 * Creates a trip on plannedFor and one draft order for each store that can fill
 * the list. Returns the trip id. Items that cannot be priced stay on the list.
 *
 * fulfillmentMethod chooses how the group receives the groceries for this trip:
 * - self_pickup: a member shops in person
 * - store_pickup: the store prepares the order and a member picks it up
 * - delivery: the store delivers to deliveryLocationId (one of the caller's saved addresses)
 *
 * Confirm each order before placing it.
 */
export async function createTripFromList(input: {
  listId: string;
  plannedFor: string;
  fulfillmentMethod?: FulfillmentMethod;
  deliveryLocationId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    fail('Sign up or log in to place an order.');
  }
  const method = input.fulfillmentMethod ?? 'self_pickup';
  if (method === 'delivery' && !input.deliveryLocationId) {
    fail('Delivery needs one of your saved addresses.');
  }
  if (method !== 'delivery' && input.deliveryLocationId) {
    fail('Only a delivery trip stores a delivery address.');
  }
  return unwrap(
    await supabase.rpc('create_trip_from_list', {
      p_list_id: input.listId,
      p_planned_for: input.plannedFor,
      p_fulfillment_method: method,
      p_delivery_location_id: input.deliveryLocationId ?? null,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null,
    }),
  );
}

/** A trip and the per-store orders under it. The date lives on the trip. */
export async function getTrip(tripId: string): Promise<{ trip: ShoppingTrip; orders: OrderSummary[] }> {
  const trip = unwrapOne<ShoppingTrip>(
    await supabase.from('shopping_trips').select('*').eq('id', tripId).maybeSingle(),
    'Trip not found.',
  );
  const orders = unwrap(await supabase.from('v_order_summary').select('*').eq('trip_id', tripId));
  return { trip, orders };
}

/**
 * Open draft trip for a group on a calendar date, if one exists.
 * Used so Order does not create duplicate trips for the same day.
 */
export async function findOpenTrip(
  groupId: string,
  plannedFor: string,
): Promise<ShoppingTrip | null> {
  const { data, error } = await supabase
    .from('shopping_trips')
    .select('*')
    .eq('group_id', groupId)
    .eq('planned_for', plannedFor)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail(error, 'Could not look up an open trip.');
  return data;
}

/**
 * Orders for a group (past placed, or drafts). Newest planned_for first.
 * Enriches v_order_summary with store display names.
 */
export async function listGroupOrders(
  groupId: string,
  options?: { status?: TripStatus | TripStatus[] },
): Promise<GroupOrderRow[]> {
  let query = supabase.from('v_order_summary').select('*').eq('group_id', groupId);
  const status = options?.status;
  if (Array.isArray(status)) {
    if (status.length === 1) {
      query = query.eq('status', status[0]);
    } else if (status.length > 1) {
      query = query.in('status', status);
    }
  } else if (status) {
    query = query.eq('status', status);
  }
  const rows = unwrap(await query.order('planned_for', { ascending: false }));
  if (rows.length === 0) return [];

  const storeIds = [...new Set(rows.map((row) => row.store_id))];
  const stores = unwrap(
    await supabase.from('stores').select('id, name').in('id', storeIds),
  );
  const nameById = new Map(stores.map((store) => [store.id, store.name]));

  return rows.map((row) => ({
    ...row,
    store_name: nameById.get(row.store_id) ?? 'Store',
  }));
}

/** Frozen lines for one store order. unit_price_cents is the planning estimate. */
export async function listOrderItems(orderId: string): Promise<OrderItem[]> {
  return unwrap(await supabase.from('order_items').select('*').eq('order_id', orderId));
}

/**
 * The signed-in buyer confirms a draft and becomes its payer. Another member
 * cannot confirm an order that already names a payer. Call this after the buyer
 * accepts the confirmation notification.
 */
export async function confirmOrder(orderId: string): Promise<void> {
  unwrapVoid(await supabase.rpc('confirm_order', { p_order_id: orderId }));
}

/**
 * Places a confirmed order. The database writes purchases for the payer and
 * even expense shares for everyone else. Do not update orders.status directly.
 */
export async function finalizeOrder(orderId: string): Promise<void> {
  unwrapVoid(await supabase.rpc('finalize_order', { p_order_id: orderId }));
}

/** Cancels a draft order. Placed orders keep their purchases and shares. */
export async function cancelOrder(orderId: string): Promise<Order> {
  return unwrapOne(
    await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle(),
    'Only a draft order can be cancelled.',
  );
}

/**
 * Asks the checkout Edge Function for an Instacart link and stores it on the
 * order. The app opens checkout_url; it never handles a card number.
 */
export async function requestCheckoutLink(orderId: string): Promise<string> {
  const result = await supabase.functions.invoke('create-checkout-link', { body: { orderId } });
  if (result.error) fail(result.error, 'Could not create a checkout link.');
  const url = (result.data as { checkoutUrl?: string } | null)?.checkoutUrl;
  if (!url) fail('Checkout function did not return a URL.');
  return url;
}

/** What each non-payer owes for one order. */
export async function listOrderShares(orderId: string): Promise<OrderShare[]> {
  return unwrap(await supabase.from('order_shares').select('*').eq('order_id', orderId));
}

/**
 * The payer marks one member's share paid after repayment outside the app.
 * settled_via is always manual in this version.
 */
export async function markSharePaid(shareId: string): Promise<OrderShare> {
  return unwrapOne(
    await supabase
      .from('order_shares')
      .update({ status: 'paid', settled_via: 'manual', settled_at: new Date().toISOString() })
      .eq('id', shareId)
      .select('*')
      .maybeSingle(),
    'Share update did not return a row. Only the payer can mark a share paid.',
  );
}

/**
 * Preview of the even split before an order is placed. The database uses the
 * same floor-and-remainder rule when the order is finalized.
 */
export function previewEvenSplit(totalCents: number, memberCount: number): {
  eachNonPayerOwesCents: number;
  payerCoversCents: number;
} {
  return {
    eachNonPayerOwesCents: evenShareCents(totalCents, memberCount),
    payerCoversCents: payerRemainderCents(totalCents, memberCount),
  };
}

/** Display names for store ids. Unknown ids are left out. */
export async function getStoreNames(storeIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(storeIds)];
  if (ids.length === 0) return new Map();
  const rows = unwrap(await supabase.from('stores').select('id, name').in('id', ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Places one store's order for one grocery run. create_trip_from_list snapshots
 * every open list item, so this trims the store's draft to listItemIds, cancels
 * the other stores' drafts on that new trip, then confirms and finalizes as the
 * caller (who becomes the payer). The ordered list items are checked off so they
 * leave the list and are not ordered again.
 */
export async function placeRunOrder(input: {
  listId: string;
  plannedFor: string;
  storeId: string;
  listItemIds: string[];
}): Promise<{ orderId: string; checkoutUrl: string | null }> {
  if (input.listItemIds.length === 0) fail('This order has no items.');
  const tripId = await createTripFromList({
    listId: input.listId,
    plannedFor: input.plannedFor,
    fulfillmentMethod: 'self_pickup',
  });
  const { orders } = await getTrip(tripId);
  const draft = orders.find((row) => row.store_id === input.storeId && row.status === 'draft');

  for (const other of orders) {
    if (other.status === 'draft' && other.order_id !== draft?.order_id) {
      await cancelOrder(other.order_id).catch(() => undefined);
    }
  }
  if (!draft) {
    fail('That store can no longer fill this order. Pull to refresh the plan.');
  }

  unwrapVoid(
    await supabase
      .from('order_items')
      .delete()
      .eq('order_id', draft.order_id)
      .not('list_item_id', 'in', `(${input.listItemIds.join(',')})`),
  );
  const kept = unwrap(
    await supabase.from('order_items').select('list_item_id').eq('order_id', draft.order_id),
  );
  if (kept.length === 0) {
    await cancelOrder(draft.order_id).catch(() => undefined);
    fail('None of these items are available at that store anymore.');
  }

  await confirmOrder(draft.order_id);
  let checkoutUrl: string | null = draft.checkout_url;
  try {
    checkoutUrl = await requestCheckoutLink(draft.order_id);
  } catch {
    // Checkout link is optional; finalize still places the order.
  }
  await finalizeOrder(draft.order_id);

  const orderedIds = kept
    .map((row) => row.list_item_id)
    .filter((id): id is string => Boolean(id));
  if (orderedIds.length > 0) {
    await supabase
      .from('list_items')
      .update({ done_at: new Date().toISOString() })
      .in('id', orderedIds);
  }
  return { orderId: draft.order_id, checkoutUrl };
}

/**
 * Ensures a draft trip for the day, then confirms + finalizes the draft order
 * for one store. Optionally requests a checkout URL before finalize.
 */
export async function placeStoreOrderFromList(input: {
  listId: string;
  groupId: string;
  plannedFor: string;
  storeId: string;
}): Promise<{ orderId: string; checkoutUrl: string | null }> {
  let trip = await findOpenTrip(input.groupId, input.plannedFor);
  const tripId =
    trip?.id ??
    (await createTripFromList({
      listId: input.listId,
      plannedFor: input.plannedFor,
      fulfillmentMethod: 'self_pickup',
    }));

  const { orders } = await getTrip(tripId);
  const draft = orders.find(
    (row) => row.store_id === input.storeId && row.status === 'draft',
  );
  if (!draft) {
    fail('No draft order for that store. Refresh the plan and try again.');
  }

  await confirmOrder(draft.order_id);
  let checkoutUrl: string | null = draft.checkout_url;
  try {
    checkoutUrl = await requestCheckoutLink(draft.order_id);
  } catch {
    // Checkout link is optional; finalize still places the order.
  }
  await finalizeOrder(draft.order_id);
  return { orderId: draft.order_id, checkoutUrl };
}
