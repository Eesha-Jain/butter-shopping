import type {
  FulfillmentMethod,
  Order,
  OrderItem,
  OrderShare,
  OrderSummary,
  ShoppingTrip,
} from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { evenShareCents, payerRemainderCents } from './money';
import { unwrap, unwrapOne, unwrapVoid } from './query';

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
