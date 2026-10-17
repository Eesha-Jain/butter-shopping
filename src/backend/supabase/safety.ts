import type { Product, ProductTrait } from './database.types';
import { supabase } from './client';
import { productWarnings } from './catalog';
import { unwrap } from './query';

/**
 * Whether a product can still be recommended. is_active false means it was
 * recalled or discontinued. Historical purchases still point at the row.
 */
export async function getProductSafety(productId: string): Promise<{
  product: Product | null;
  traits: ProductTrait[];
  warnings: { traitName: string; relation: string; mode: string }[];
}> {
  const product = unwrap(
    await supabase.from('products').select('*').eq('id', productId).maybeSingle(),
  );
  const traits = unwrap(await supabase.from('product_traits').select('*').eq('product_id', productId));
  const warnings = product ? await productWarnings(productId) : [];
  return { product, traits, warnings };
}

/**
 * Traits whose observed_at is newer than the caller's last review can be passed
 * in changedSince. This is how a screen notices that a familiar product gained
 * an ingredient. It does not store a separate alert table.
 */
export async function traitsChangedSince(input: {
  productId: string;
  changedSince: string;
}): Promise<ProductTrait[]> {
  return unwrap(
    await supabase
      .from('product_traits')
      .select('*')
      .eq('product_id', input.productId)
      .gt('observed_at', input.changedSince),
  );
}
