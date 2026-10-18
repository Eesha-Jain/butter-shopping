import { fail } from '../errors';
import { supabase } from './client';
import { unwrap, unwrapVoid } from './query';

async function requireUserId(): Promise<string> {
  const result = await supabase.auth.getUser();
  if (result.error || !result.data.user) {
    fail(result.error ?? 'Sign in first.');
  }
  return result.data.user.id;
}

/** Product ids the signed-in user has favorited. Empty when signed out. */
export async function listMyFavoriteProductIds(): Promise<string[]> {
  const user = await supabase.auth.getUser();
  if (!user.data.user) return [];
  const rows = unwrap(
    await supabase.from('product_favorites').select('product_id').eq('user_id', user.data.user.id),
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
