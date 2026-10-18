import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGuestCart } from '@/auth/guest-cart-context';
import { useRequireAccount } from '@/auth/require-account';
import { useSession } from '@/auth/session';
import { BottomTabInset, Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function CartScreen() {
  const theme = useTheme();
  const { session, isGuest } = useSession();
  const { items, setQuantity, removeItem } = useGuestCart();
  const requireAccount = useRequireAccount();

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

  // Guests use the on-device cart; signed-in synced lists are not wired to this UI yet.
  const showGuestCart = isGuest || !session;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.frame}>
        <Text style={[styles.title, { color: theme.text }]}>Cart</Text>

        {showGuestCart ? (
          items.length === 0 ? (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              Your cart is empty. Browse the shop and add items — you can check out after creating
              an account.
            </Text>
          ) : (
            <View style={styles.list}>
              {items.map((item) => (
                <View
                  key={item.id}
                  style={[styles.row, { borderColor: theme.border, backgroundColor: theme.background }]}>
                  <View style={styles.rowBody}>
                    <Text style={[styles.itemName, { color: theme.text }]}>
                      {item.customName ?? `Product ${item.productId?.slice(0, 8) ?? ''}`}
                    </Text>
                    <Text style={[styles.qty, { color: theme.textSecondary }]}>
                      Qty {item.quantity}
                    </Text>
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
          )
        ) : (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            Your shared grocery list will show here once shopping is wired up.
          </Text>
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
  list: {
    gap: Spacing.two,
    flex: 1,
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
