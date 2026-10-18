import { getJson, removeItem, setJson } from './storage';
import { addListItem, getMyDefaultList } from './supabase/lists';

export type GuestCartItem = {
  /** Stable local id for list keys / remove. */
  id: string;
  productId?: string;
  customName?: string;
  quantity: number;
};

function readCart(): GuestCartItem[] {
  const items = getJson<GuestCartItem[]>('guestCart');
  return Array.isArray(items) ? items : [];
}

function writeCart(items: GuestCartItem[]): void {
  setJson('guestCart', items);
}

export function getGuestCart(): GuestCartItem[] {
  return readCart();
}

export function clearGuestCart(): void {
  removeItem('guestCart');
}

/**
 * Adds or bumps quantity. Supply exactly one of productId or customName.
 */
export function addGuestCartItem(input: {
  productId?: string;
  customName?: string;
  quantity?: number;
}): GuestCartItem {
  const quantity = input.quantity ?? 1;
  const hasProduct = Boolean(input.productId);
  const hasCustom = Boolean(input.customName?.trim());
  if (hasProduct === hasCustom) {
    throw new Error('A guest cart item needs exactly one of a product or a custom name.');
  }

  const items = readCart();
  const existing = items.find((row) =>
    input.productId
      ? row.productId === input.productId
      : row.customName === input.customName?.trim(),
  );

  if (existing) {
    existing.quantity += quantity;
    writeCart(items);
    return existing;
  }

  const next: GuestCartItem = {
    id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: input.productId,
    customName: input.customName?.trim(),
    quantity,
  };
  items.push(next);
  writeCart(items);
  return next;
}

export function updateGuestCartQuantity(id: string, quantity: number): void {
  const items = readCart();
  const row = items.find((item) => item.id === id);
  if (!row) return;
  if (quantity <= 0) {
    writeCart(items.filter((item) => item.id !== id));
    return;
  }
  row.quantity = quantity;
  writeCart(items);
}

export function removeGuestCartItem(id: string): void {
  writeCart(readCart().filter((item) => item.id !== id));
}

/**
 * Copies local guest cart lines onto the signed-in user's default list, then clears
 * the device cart. No-ops when the cart is empty.
 */
export async function mergeGuestCartIntoDefaultList(): Promise<number> {
  const items = readCart();
  if (items.length === 0) return 0;

  const { list } = await getMyDefaultList();
  let merged = 0;
  for (const item of items) {
    if (item.productId) {
      await addListItem({
        listId: list.id,
        productId: item.productId,
        quantity: item.quantity,
      });
      merged += 1;
    }
  }
  clearGuestCart();
  return merged;
}
