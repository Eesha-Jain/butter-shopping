import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGuestCart } from '@/auth/guest-cart-context';
import { useRequireAccount } from '@/auth/require-account';
import { useSession } from '@/auth/session';
import { ButterButton } from '@/components/ui/butter-button';
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
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.frame}>
        <Animated.View entering={FadeInDown.duration(280)} style={styles.headerBlock}>
          <Text style={[styles.title, { color: theme.text }]}>Cart</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Review items, then place an order when you are ready.
          </Text>
        </Animated.View>

        {showGuestCart ? (
          items.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>Your cart is empty</Text>
              <Text style={[styles.empty, { color: theme.textSecondary }]}>
                Browse the shop and add a few chops — checkout is one account away.
              </Text>
              <ButterButton label="Browse shop" variant="yellow" onPress={() => router.push('/')} />
            </View>
          ) : (
            <View style={styles.list}>
              {items.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.row,
                    {
                      borderColor: theme.borderInk,
                      backgroundColor: theme.background,
                    },
                  ]}>
                  <View style={styles.rowBody}>
                    <Text style={[styles.itemName, { color: theme.text }]}>
                      {item.customName ?? `Product ${item.productId?.slice(0, 8) ?? ''}`}
                    </Text>
                    <Text style={[styles.qty, { color: theme.textSecondary }]}>
                      Qty {item.quantity}
                    </Text>
                  </View>
                  <View style={styles.rowActions}>
                    <View
                      style={[
                        styles.stepper,
                        {
                          backgroundColor: theme.backgroundSelected,
                          borderColor: theme.borderInk,
                        },
                      ]}>
                      <Text
                        onPress={() => setQuantity(item.id, item.quantity - 1)}
                        style={[styles.stepLabel, { color: theme.text }]}>
                        −
                      </Text>
                      <Text style={[styles.stepLabel, { color: theme.text }]}>
                        {item.quantity}
                      </Text>
                      <Text
                        onPress={() => setQuantity(item.id, item.quantity + 1)}
                        style={[styles.stepLabel, { color: theme.text }]}>
                        +
                      </Text>
                    </View>
                    <Text
                      onPress={() => removeItem(item.id)}
                      style={{ color: theme.error, fontFamily: Fonts.sansBold, fontSize: 13 }}>
                      Remove
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )
        ) : (
          <View style={styles.emptyBlock}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>List coming soon</Text>
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              Your shared grocery list will show here once shopping is wired up.
            </Text>
            <ButterButton label="Browse shop" variant="ghost" onPress={() => router.push('/')} />
          </View>
        )}

        {showGuestCart && items.length > 0 ? (
          <>
            <ButterButton label="Place order" variant="ink" onPress={onCheckout} />
            {!session ? (
              <Text style={[styles.hint, { color: theme.textSecondary }]}>
                Guests can build a cart; an account is required to order.
              </Text>
            ) : null}
          </>
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
  headerBlock: {
    gap: Spacing.one,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 28,
    lineHeight: 32,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyBlock: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    alignItems: 'stretch',
  },
  emptyTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 22,
    textAlign: 'center',
  },
  empty: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  list: {
    gap: Spacing.two,
    flex: 1,
  },
  row: {
    borderWidth: 2,
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
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 2,
    paddingHorizontal: Spacing.two,
    gap: Spacing.three,
    minHeight: 36,
  },
  stepLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    paddingHorizontal: Spacing.one,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    textAlign: 'center',
  },
});
