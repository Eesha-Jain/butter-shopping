import { adminClient, json, requireServiceRole, sendExpoPush } from '../_shared/supabase.ts';

type OffIngredient = { id?: string; text?: string };
type OffProduct = {
  product_name?: string;
  ingredients_text?: string;
  ingredients?: OffIngredient[];
  allergens_tags?: string[];
  traces_tags?: string[];
  labels_tags?: string[];
};

const LABEL_TRAITS: Record<string, { code: string; relation: 'suitable' | 'certified' }> = {
  'en:vegan': { code: 'vegan', relation: 'suitable' },
  'en:vegetarian': { code: 'vegetarian', relation: 'suitable' },
  'en:gluten-free': { code: 'gluten-free', relation: 'suitable' },
  'en:halal': { code: 'halal', relation: 'certified' },
  'en:kosher': { code: 'kosher', relation: 'certified' },
  'en:organic': { code: 'organic', relation: 'certified' },
};

/**
 * Reads Open Food Facts for one barcode, replaces that product's traits, and
 * updates ingredients_text only when the text changed. When a newly observed
 * avoid-rule conflict appears, it sends a best-effort push to recent purchasers.
 * Call this with the service role. It does not store the raw API response.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
    requireServiceRole(req);
    const { upc } = await req.json() as { upc?: string };
    if (!upc) return json({ error: 'upc is required.' }, 400);

    const supabase = adminClient();
    const productResult = await supabase.from('products').select('id, ingredients_text').eq('upc', upc).maybeSingle();
    if (productResult.error || !productResult.data) return json({ error: 'Product not found for that barcode.' }, 404);
    const product = productResult.data;

    const response = await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(upc)}.json`);
    if (!response.ok) return json({ error: 'Open Food Facts did not return this product.' }, 502);
    const body = await response.json() as { product?: OffProduct };
    const off = body.product;
    if (!off) return json({ error: 'Open Food Facts has no product payload.' }, 404);

    const previous = await supabase.from('product_traits').select('trait_id, relation').eq('product_id', product.id);
    await supabase.from('product_traits').delete().eq('product_id', product.id);

    const traits = await supabase.from('food_traits').select('id, code, kind');
    const byCode = new Map((traits.data ?? []).map((trait) => [trait.code, trait]));
    const rowsByKey = new Map<string, { product_id: string; trait_id: string; relation: string; source: string }>();
    const addRow = (traitId: string, relation: string) => {
      rowsByKey.set(`${traitId}:${relation}`, {
        product_id: product.id,
        trait_id: traitId,
        relation,
        source: 'external',
      });
    };

    for (const tag of [...(off.allergens_tags ?? []), ...(off.traces_tags ?? [])]) {
      const code = tag.replace(/^en:/, '');
      const trait = byCode.get(code);
      if (!trait) continue;
      addRow(trait.id, (off.traces_tags ?? []).includes(tag) ? 'may_contain' : 'contains');
    }
    for (const [tag, mapped] of Object.entries(LABEL_TRAITS)) {
      if (!(off.labels_tags ?? []).includes(tag)) continue;
      const trait = byCode.get(mapped.code);
      if (!trait) continue;
      addRow(trait.id, mapped.relation);
    }
    for (const ingredient of off.ingredients ?? []) {
      const code = ingredient.id?.replace(/^en:/, '');
      const trait = code ? byCode.get(code) : undefined;
      if (!trait || trait.kind === 'dietary' || trait.kind === 'certification') continue;
      addRow(trait.id, 'contains');
    }
    const rows = [...rowsByKey.values()];
    if (rows.length > 0) await supabase.from('product_traits').insert(rows);

    const nextText = off.ingredients_text ?? null;
    if (nextText !== product.ingredients_text) {
      await supabase.from('products').update({
        ingredients_text: nextText,
        ingredients_updated_at: new Date().toISOString(),
      }).eq('id', product.id);
    }

    const oldKeys = new Set((previous.data ?? []).map((row) => `${row.trait_id}:${row.relation}`));
    const added = rows.filter((row) => !oldKeys.has(`${row.trait_id}:${row.relation}`));
    if (added.length > 0) {
      await notifyPurchasers(supabase, product.id, 'A product you buy has updated ingredient information.');
    }
    return json({ productId: product.id, traitsWritten: rows.length });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Composition sync failed.' }, 500);
  }
});

async function notifyPurchasers(
  supabase: ReturnType<typeof adminClient>,
  productId: string,
  body: string,
): Promise<void> {
  const listings = await supabase.from('store_products').select('id').eq('product_id', productId);
  const listingIds = (listings.data ?? []).map((row) => row.id);
  if (listingIds.length === 0) return;
  const purchases = await supabase.from('purchases').select('user_id').in('store_product_id', listingIds);
  const userIds = [...new Set((purchases.data ?? []).map((row) => row.user_id))];
  if (userIds.length === 0) return;
  const tokens = await supabase.from('push_tokens').select('token').in('user_id', userIds);
  await sendExpoPush((tokens.data ?? []).map((row) => ({
    to: row.token,
    title: 'Ingredient update',
    body,
  })));
}
