import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut, FadeOutUp, LinearTransition } from 'react-native-reanimated';

import { MemberAvatar } from '@/components/groups/member-avatar';
import type { RunOrder, RunOrderLine } from '@/components/plan/plan-orders';
import { StoreLogo } from '@/components/plan/store-logo';
import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PLACED_GREEN = '#2E9E5B';
const MAX_THUMBS = 5;
const DRAWER_MS = 240;
export const drawerLayout = LinearTransition.duration(DRAWER_MS);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  order: RunOrder;
  expanded: boolean;
  placing: boolean;
  myUserId: string | null;
  grouped?: boolean;
  /** Show which group/list this order is for (when the Plan mixes several). */
  showSource: boolean;
  imageForLine: (line: RunOrderLine) => string | null;
  renderLine: (line: RunOrderLine) => ReactNode;
  onToggle: () => void;
  onPlace: () => void;
  onOpenPlaced: () => void;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** One store order on a grocery run: who shops, what's in it, and its status. */
export function RunOrderCard({
  order,
  expanded,
  placing,
  myUserId,
  grouped = false,
  showSource,
  imageForLine,
  renderLine,
  onToggle,
  onPlace,
  onOpenPlaced,
}: Props) {
  const theme = useTheme();
  const [hint, setHint] = useState(false);
  const isPlaced = order.kind === 'placed';
  const isUnpriced = order.kind === 'unpriced';
  const canExpand = !isPlaced && order.lines.length > 0;
  const shopperName =
    order.shopper && order.shopper.userId === myUserId ? 'You' : order.shopper?.name;

  const meta = [
    showSource && !grouped ? order.sourceLabel : null,
    `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}`,
    !isUnpriced && order.totalCents > 0
      ? `${isPlaced ? '' : '~'}${formatMoney(order.totalCents)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const status = isPlaced
    ? { label: 'Placed', bg: PLACED_GREEN, fg: '#fff' }
    : isUnpriced
      ? { label: order.pending ? 'Pricing' : 'No price', bg: theme.backgroundElement, fg: theme.textSecondary }
      : { label: 'Planned', bg: theme.primary, fg: theme.secondary };

  const chevron = (open: boolean) => (
    <SymbolView
      name={{
        ios: open ? 'chevron.up' : 'chevron.down',
        android: open ? 'expand_less' : 'expand_more',
        web: open ? 'expand_less' : 'expand_more',
      }}
      size={18}
      tintColor={theme.textSecondary}
    />
  );

  return (
    <Animated.View
      layout={drawerLayout}
      style={[
        styles.card,
        grouped ? styles.groupedCard : null,
        {
          backgroundColor: grouped ? 'transparent' : theme.background,
          borderColor: isUnpriced ? theme.border : theme.borderInk,
        },
      ]}>
      <Pressable
        onPress={isPlaced ? onOpenPlaced : canExpand ? onToggle : undefined}
        accessibilityRole="button"
        accessibilityState={canExpand ? { expanded } : undefined}
        accessibilityLabel={`${order.storeName} order, ${meta}, ${status.label}${shopperName ? `, ${shopperName} shopping` : ''}`}
        style={styles.header}>
        {!grouped ? <StoreLogo storeName={order.storeName} unknown={isUnpriced} size={36} /> : null}
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.storeName}>
              {grouped ? order.sourceLabel : order.storeName}
            </ThemedText>
            <View style={[styles.pill, { backgroundColor: status.bg }]}>
              <ThemedText style={[styles.pillText, { color: status.fg }]}>{status.label}</ThemedText>
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {meta}
          </ThemedText>
        </View>
        {order.shopper ? (
          <View style={styles.shopper}>
            <MemberAvatar
              userId={order.shopper.userId}
              name={order.shopper.name}
              avatarUrl={order.shopper.avatarUrl}
              size={30}
              ringColor={theme.borderInk}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.shopperName} numberOfLines={1}>
              {shopperName}
            </ThemedText>
          </View>
        ) : null}
        {order.kind === 'planned' ? (
          <View>
            <Pressable
              onPress={() => {
                setHint(false);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPlace();
              }}
              onLongPress={() => {
                void Haptics.selectionAsync();
                setHint(true);
              }}
              onPressOut={() => setHint(false)}
              disabled={placing}
              accessibilityRole="button"
              accessibilityLabel={`Place order at ${order.storeName}`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.placeBtn,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.borderInk,
                  opacity: placing ? 0.6 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                },
              ]}>
              {placing ? (
                <ActivityIndicator size="small" color={theme.secondary} />
              ) : (
                <SymbolView
                  name={{ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }}
                  size={17}
                  tintColor={theme.secondary}
                />
              )}
            </Pressable>
            {hint ? (
              <Animated.View
                entering={FadeIn.duration(120)}
                exiting={FadeOut.duration(120)}
                pointerEvents="none"
                style={[styles.hint, { backgroundColor: theme.text }]}>
                <ThemedText type="smallBold" style={[styles.hintText, { color: theme.background }]}>
                  Place order
                </ThemedText>
              </Animated.View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {!expanded && order.lines.length > 0 ? (
        <AnimatedPressable
          entering={FadeIn.duration(DRAWER_MS)}
          exiting={FadeOut.duration(120)}
          onPress={canExpand ? onToggle : undefined}
          accessibilityRole={canExpand ? 'button' : undefined}
          accessibilityLabel={canExpand ? 'Show items' : undefined}
          style={styles.thumbs}>
          {order.lines.slice(0, MAX_THUMBS).map((line) => {
            const name = line.item.display_name?.trim() || line.item.custom_name?.trim() || '?';
            return (
              <ProductPhoto
                key={line.item.id}
                imagePath={imageForLine(line)}
                placeholderLetter={name.slice(0, 1)}
                size={36}
              />
            );
          })}
          {order.lines.length > MAX_THUMBS ? (
            <ThemedText type="small" themeColor="textSecondary">
              +{order.lines.length - MAX_THUMBS}
            </ThemedText>
          ) : null}
          <View style={styles.flex} />
          {canExpand ? chevron(false) : null}
        </AnimatedPressable>
      ) : null}

      {expanded && canExpand ? (
        <Animated.View
          entering={FadeInUp.duration(DRAWER_MS)}
          exiting={FadeOutUp.duration(160)}
          style={[styles.lines, { borderTopColor: theme.border }]}>
          {order.lines.map(renderLine)}
          <Pressable
            onPress={onToggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Hide items"
            style={styles.hide}>
            {chevron(true)}
          </Pressable>
        </Animated.View>
      ) : null}

      {isUnpriced && !order.pending ? (
        <ThemedText type="small" themeColor="textSecondary">
          No nearby store has a price for these yet. Pick a product in Shop to order them.
        </ThemedText>
      ) : isPlaced ? (
        <ThemedText type="small" themeColor="textSecondary">
          {order.placed?.paid_by && order.placed.paid_by === myUserId
            ? 'You placed this order. Tap for the receipt and splits.'
            : 'Tap for the receipt and splits.'}
        </ThemedText>
      ) : null}
    </Animated.View>
  );
}


const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  groupedCard: {
    borderWidth: 0,
    borderRadius: 0,
    padding: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  storeName: {
    flexShrink: 1,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  pillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    lineHeight: 15,
  },
  shopper: {
    alignItems: 'center',
    gap: 2,
    maxWidth: 64,
  },
  shopperName: {
    fontSize: 11,
    lineHeight: 14,
  },
  thumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  flex: {
    flex: 1,
  },
  lines: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  hide: {
    alignSelf: 'center',
  },
  placeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    top: 7,
    right: 46,
    width: 96,
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    zIndex: 10,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
