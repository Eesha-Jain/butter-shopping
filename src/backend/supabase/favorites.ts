import { fail } from '../errors';
import { getOptionalUserId } from './auth';
import { supabase } from './client';
import { unwrap, unwrapVoid } from './query';

async function requireUserId(): Promise<string> {
  const userId = await getOptionalUserId();
  if (!userId) fail('Sign in first.');
  return userId;
}

/** Product ids the signed-in user has favorited. Empty when signed out. */
export async function listMyFavoriteProductIds(): Promise<string[]> {
  const userId = await getOptionalUserId();
  if (!userId) return [];
  const rows = unwrap(
    await supabase.from('product_favorites').select('product_id').eq('user_id', userId),
  );
  return rows.map((row) => row.product_id);
}

/** Adds or removes a favorite for the signed-in user. */
export async function setProductFavorite(productId: string, favored: boolean): Promise<void> {
  const userId = await requireUserId();
  if (!productId) fail('A product id is required.');
  if (favored) {
    unwrapVoid(
      await supabase.from('product_favorites').upsert(
        { user_id: userId, product_id: productId },
        { onConflict: 'user_id,product_id' },
      ),
    );
    return;
  }
  unwrapVoid(
    await supabase
      .from('product_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId),
  );
}
