import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  addGuestCartItem,
  clearGuestCart,
  getGuestCart,
  removeGuestCartItem,
  updateGuestCartQuantity,
  type GuestCartItem,
} from '@/backend/guest-cart';
import { useSession } from '@/auth/session';

type GuestCartContextValue = {
  items: GuestCartItem[];
  itemCount: number;
  refresh: () => void;
  addItem: (input: { productId?: string; customName?: string; quantity?: number }) => GuestCartItem;
  setQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clear: () => void;
};

const GuestCartContext = createContext<GuestCartContextValue | null>(null);

export function useGuestCart(): GuestCartContextValue {
  const value = use(GuestCartContext);
  if (!value) {
    throw new Error('useGuestCart must be used within a GuestCartProvider');
  }
  return value;
}

export function GuestCartProvider({ children }: PropsWithChildren) {
  const { session } = useSession();
  const [guestItems, setGuestItems] = useState<GuestCartItem[]>(() => getGuestCart());

  const refresh = useCallback(() => {
    setGuestItems(getGuestCart());
  }, []);

  const addItem = useCallback(
    (input: { productId?: string; customName?: string; quantity?: number }) => {
      const next = addGuestCartItem(input);
      setGuestItems(getGuestCart());
      return next;
    },
    [],
  );

  const setQuantity = useCallback((id: string, quantity: number) => {
    updateGuestCartQuantity(id, quantity);
    setGuestItems(getGuestCart());
  }, []);

  const removeItem = useCallback((id: string) => {
    removeGuestCartItem(id);
    setGuestItems(getGuestCart());
  }, []);

  const clear = useCallback(() => {
    clearGuestCart();
    setGuestItems([]);
  }, []);

  const value = useMemo<GuestCartContextValue>(() => {
    // Signed-in users see an empty guest cart UI; merge clears storage in SessionProvider.
    const items = session ? [] : guestItems;
    return {
      items,
      itemCount: items.reduce((sum, row) => sum + row.quantity, 0),
      refresh,
      addItem,
      setQuantity,
      removeItem,
      clear,
    };
  }, [session, guestItems, refresh, addItem, setQuantity, removeItem, clear]);

  return <GuestCartContext.Provider value={value}>{children}</GuestCartContext.Provider>;
}
