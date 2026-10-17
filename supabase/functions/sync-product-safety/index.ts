import { adminClient, json, requireServiceRole, sendExpoPush } from '../_shared/supabase.ts';

/**
 * Checks current FDA food recalls and USDA FSIS recalls. When a recall text
 * contains a known product barcode, the product is marked inactive and recent
 * purchasers get one best-effort push. Recall records are not stored. A missed
 * run does not leave a retry queue.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
    requireServiceRole(req);
    const supabase = adminClient();
    const products = await supabase.from('products').select('id, upc, name').not('upc', 'is', null).eq('is_active', true);
    const catalog = products.data ?? [];
    const recallText = await loadRecallText();
    const matched = catalog.filter((product) => product.upc && recallText.includes(product.upc));

    for (const product of matched) {
      await supabase.from('products').update({ is_active: false }).eq('id', product.id);
      const listings = await supabase.from('store_products').select('id').eq('product_id', product.id);
      const ids = (listings.data ?? []).map((row) => row.id);
      if (ids.length === 0) continue;
      const purchases = await supabase.from('purchases').select('user_id').in('store_product_id', ids);
      const userIds = [...new Set((purchases.data ?? []).map((row) => row.user_id))];
      if (userIds.length === 0) continue;
      const tokens = await supabase.from('push_tokens').select('token').in('user_id', userIds);
    const invalid = await sendExpoPush((tokens.data ?? []).map((row) => ({
      to: row.token,
      title: 'Product unavailable',
      body: `${product.name} was matched to a current recall and was removed from recommendations.`,
    })));
    if (invalid.length > 0) {
      await supabase.from('push_tokens').delete().in('token', invalid);
    }
    }

    return json({ checked: catalog.length, deactivated: matched.length });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Safety sync failed.' }, 500);
  }
});

async function loadRecallText(): Promise<string> {
  const chunks: string[] = [];
  const fdaKey = Deno.env.get('OPENFDA_API_KEY');
  const fdaUrl = new URL('https://api.fda.gov/food/enforcement.json');
  fdaUrl.searchParams.set('search', 'status:"Ongoing"');
  fdaUrl.searchParams.set('limit', '100');
  if (fdaKey) fdaUrl.searchParams.set('api_key', fdaKey);
  const fda = await fetch(fdaUrl);
  if (fda.ok) {
    const body = await fda.json() as { results?: { code_info?: string; product_description?: string }[] };
    chunks.push(...(body.results ?? []).map((row) => `${row.code_info ?? ''} ${row.product_description ?? ''}`));
  }
  const usda = await fetch('https://www.fsis.usda.gov/fsis/api/recall/v/1');
  if (usda.ok) chunks.push(await usda.text());
  return chunks.join('\n');
}
