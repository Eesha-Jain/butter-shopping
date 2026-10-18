import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGuestCart } from '@/auth/guest-cart-context';
import { useRequireAccount } from '@/auth/require-account';
import { useSession } from '@/auth/session';
import {
  getMyDefaultList,
  listResolvedItems,
  removeListItem,
  updateListItem,
  type ResolvedListItem,
} from '@/backend';
import { BottomTabInset, Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function CartScreen() {
  const theme = useTheme();
  const { session, isGuest } = useSession();
  const { items, setQuantity, removeItem } = useGuestCart();
  const requireAccount = useRequireAccount();

  const showGuestCart = isGuest || !session;

  function onCheckout() {
    if (
      !requireAccount(
        'Sign up or log in to place an order. Your cart will be saved to your account.',
      )
    ) {
      return;
    }
    // Signed-in checkout / Instacart flow is not wired yet.
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.frame}>
        <Text style={[styles.title, { color: theme.text }]}>Cart</Text>

        {showGuestCart ? (
          <GuestCartBody
            theme={theme}
            items={items}
            setQuantity={setQuantity}
            removeItem={removeItem}
          />
        ) : (
          <SignedInCartBody theme={theme} />
        )}

        <Pressable
          onPress={onCheckout}
          style={({ pressed }) => [
            styles.checkout,
            {
              backgroundColor: theme.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.checkoutLabel, { color: theme.primaryText }]}>Place order</Text>
        </Pressable>
        {!session ? (
          <Text style={[styles.hint, { color: theme.textSecondary }]}>
            Guests can build a cart; an account is required to order.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function GuestCartBody({
  theme,
  items,
  setQuantity,
  removeItem,
}: {
  theme: ReturnType<typeof useTheme>;
  items: { id: string; productId?: string; customName?: string; quantity: number }[];
  setQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        Your cart is empty. Browse the shop and add items — you can check out after creating an
        account.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View
          key={item.id}
          style={[styles.row, { borderColor: theme.border, backgroundColor: theme.background }]}>
          <View style={styles.rowBody}>
            <Text style={[styles.itemName, { color: theme.text }]}>
              {item.customName ?? `Product ${item.productId?.slice(0, 8) ?? ''}`}
            </Text>
            {item.customName ? (
              <Text style={[styles.requestTag, { color: theme.textSecondary }]}>Request</Text>
            ) : null}
            <Text style={[styles.qty, { color: theme.textSecondary }]}>Qty {item.quantity}</Text>
          </View>
          <View style={styles.rowActions}>
            <Pressable
              onPress={() => setQuantity(item.id, item.quantity - 1)}
              hitSlop={8}
              style={styles.qtyBtn}>
              <Text style={{ color: theme.text, fontFamily: Fonts.sansBold }}>−</Text>
            </Pressable>
            <Pressable
              onPress={() => setQuantity(item.id, item.quantity + 1)}
              hitSlop={8}
              style={styles.qtyBtn}>
              <Text style={{ color: theme.text, fontFamily: Fonts.sansBold }}>+</Text>
            </Pressable>
            <Pressable onPress={() => removeItem(item.id)} hitSlop={8}>
              <Text style={{ color: theme.error, fontFamily: Fonts.sans, fontSize: 13 }}>
                Remove
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function SignedInCartBody({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const [items, setItems] = useState<ResolvedListItem[] | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { list } = await getMyDefaultList();
      setListId(list.id);
      const rows = await listResolvedItems(list.id);
      setItems(rows.filter((row) => !row.done_at));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your cart.');
      if (!refresh) setItems(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bumpQty = async (item: ResolvedListItem, next: number) => {
    if (!listId) return;
    if (next <= 0) {
      await removeListItem(item.id);
    } else {
      await updateListItem(item.id, { quantity: next });
    }
    await load(true);
  };

  if (loading && items == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  if (error && items == null) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.empty, { color: theme.textSecondary }]}>{error}</Text>
        <Pressable onPress={() => void load()}>
          <Text style={{ color: theme.primary, fontFamily: Fonts.sansBold }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const openItems = items ?? [];

  if (openItems.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        Your cart is empty. Ask Butter AI to add something, or browse the shop.
      </Text>
    );
  }

  return (
    <ScrollView
      style={styles.listScroll}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={theme.text}
        />
      }>
      {error ? (
        <Text style={[styles.qty, { color: theme.textSecondary }]}>{error}</Text>
      ) : null}
      {openItems.map((item) => {
        const isRequest = Boolean(item.custom_name);
        const name = item.display_name ?? item.custom_name ?? 'Item';
        return (
          <View
            key={item.id}
            style={[styles.row, { borderColor: theme.border, backgroundColor: theme.background }]}>
            <View style={styles.rowBody}>
              <Text style={[styles.itemName, { color: theme.text }]}>{name}</Text>
              {isRequest ? (
                <Text style={[styles.requestTag, { color: theme.textSecondary }]}>Request</Text>
              ) : null}
              <Text style={[styles.qty, { color: theme.textSecondary }]}>Qty {item.quantity}</Text>
            </View>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => void bumpQty(item, Number(item.quantity) - 1)}
                hitSlop={8}
                style={styles.qtyBtn}>
                <Text style={{ color: theme.text, fontFamily: Fonts.sansBold }}>−</Text>
              </Pressable>
              <Pressable
                onPress={() => void bumpQty(item, Number(item.quantity) + 1)}
                hitSlop={8}
                style={styles.qtyBtn}>
                <Text style={{ color: theme.text, fontFamily: Fonts.sansBold }}>+</Text>
              </Pressable>
              <Pressable onPress={() => void removeListItem(item.id).then(() => load(true))} hitSlop={8}>
                <Text style={{ color: theme.error, fontFamily: Fonts.sans, fontSize: 13 }}>
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 28,
  },
  empty: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
  listScroll: {
    flex: 1,
  },
  list: {
    gap: Spacing.two,
    flexGrow: 1,
  },
  row: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowBody: {
    gap: 4,
  },
  itemName: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
  },
  requestTag: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  qty: {
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  qtyBtn: {
    minWidth: 28,
    alignItems: 'center',
  },
  checkout: {
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  checkoutLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    textAlign: 'center',
  },
});
