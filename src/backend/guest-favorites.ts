import { getJson, removeItem, setJson } from './storage';
import { setProductFavorite } from './supabase/favorites';

function readIds(): string[] {
  const ids = getJson<string[]>('guestFavorites');
  return Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];
}

function writeIds(ids: string[]): void {
  setJson('guestFavorites', [...new Set(ids.filter(Boolean))]);
}

export function getGuestFavoriteIds(): string[] {
  return readIds();
}

export function isGuestFavorite(productId: string): boolean {
  return readIds().includes(productId);
}

export function setGuestFavorite(productId: string, favored: boolean): void {
  if (!productId) return;
  const ids = readIds();
  if (favored) {
    if (!ids.includes(productId)) {
      ids.push(productId);
      writeIds(ids);
    }
    return;
  }
  writeIds(ids.filter((id) => id !== productId));
}

export function clearGuestFavorites(): void {
  removeItem('guestFavorites');
}

/** Copies on-device favorites into the signed-in account, then clears local storage. */
export async function mergeGuestFavoritesIntoAccount(): Promise<number> {
  const ids = readIds();
  if (ids.length === 0) return 0;
  let merged = 0;
  for (const productId of ids) {
    try {
      await setProductFavorite(productId, true);
      merged += 1;
    } catch {
      // Skip rows that fail (deleted products, etc.).
    }
  }
  clearGuestFavorites();
  return merged;
}
