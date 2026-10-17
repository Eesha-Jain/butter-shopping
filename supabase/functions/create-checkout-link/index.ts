import { json, requireUser, userClient } from '../_shared/supabase.ts';

/**
 * Creates an Instacart shopping-list link for one order and saves it on
 * orders.checkout_url. The Instacart key stays in the function environment.
 * The caller must belong to the order's group. No card data is handled here.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
    const user = await requireUser(req);
    const { orderId } = await req.json() as { orderId?: string };
    if (!orderId) return json({ error: 'orderId is required.' }, 400);

    const supabase = userClient(req);
    const orderResult = await supabase
      .from('orders')
      .select('id, group_id, checkout_url')
      .eq('id', orderId)
      .maybeSingle();
    if (orderResult.error || !orderResult.data) return json({ error: 'Order not found.' }, 404);

    const itemsResult = await supabase
      .from('order_items')
      .select('quantity, store_product_id')
      .eq('order_id', orderId);
    if (itemsResult.error) return json({ error: itemsResult.error.message }, 400);

    const storeProducts = await supabase
      .from('store_products')
      .select('id, product_id')
      .in('id', (itemsResult.data ?? []).map((item) => item.store_product_id));
    const products = await supabase
      .from('products')
      .select('id, name')
      .in('id', (storeProducts.data ?? []).map((row) => row.product_id));
    const names = new Map((products.data ?? []).map((product) => [product.id, product.name]));
    const productByStoreProduct = new Map(
      (storeProducts.data ?? []).map((row) => [row.id, row.product_id]),
    );

    const lineItems = (itemsResult.data ?? []).map((item) => ({
      name: names.get(productByStoreProduct.get(item.store_product_id) ?? '') ?? 'Grocery item',
      quantity: Number(item.quantity),
      unit: 'each',
    }));

    const apiKey = Deno.env.get('INSTACART_API_KEY');
    if (!apiKey) return json({ error: 'INSTACART_API_KEY is not configured.' }, 503);
    const base = Deno.env.get('INSTACART_API_BASE') ?? 'https://connect.dev.instacart.tools';
    const response = await fetch(`${base}/idp/v1/products/products_link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        title: 'Butter shopping list',
        link_type: 'shopping_list',
        line_items: lineItems,
      }),
    });
    if (!response.ok) return json({ error: 'Instacart did not create a shopping list.' }, 502);
    const payload = await response.json() as { products_link_url?: string };
    const checkoutUrl = payload.products_link_url;
    if (!checkoutUrl) return json({ error: 'Instacart did not return a link.' }, 502);

    const saved = await supabase.from('orders').update({ checkout_url: checkoutUrl }).eq('id', orderId);
    if (saved.error) return json({ error: saved.error.message }, 400);
    return json({ checkoutUrl, confirmedBy: user.id });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Checkout failed.' }, 500);
  }
});
