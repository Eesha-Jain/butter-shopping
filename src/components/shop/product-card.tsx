import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Pressable, StyleSheet, View, type View as RNView } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated';

import { productCardName, type Product } from '@/backend';
import type { ProductPeekAnchor } from '@/components/shop/product-peek-layout';
import { ProductPhoto } from '@/components/shop/product-photo';
import { SnapBadge } from '@/components/shop/snap-badge';
import { ThemedText } from '@/components/themed-text';
import { ButterBlock } from '@/components/ui/butter-block';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product;
  saleBadge?: string | null;
  /** Struck-through compare-at price when a promo implies one. */
  compareAtCents?: number | null;
  /** e.g. "Save $1" under the price. */
  savingsLabel?: string | null;
  /** Quiet note when net price includes cash back (no promo). */
  priceNote?: string | null;
  /** Show SNAP badge when the shopper opted in and this food is eligible. */
  showSnap?: boolean;
  quantityOnList?: number;
  /** @deprecated Prefer metaLabel — still maps to “Sponsored”. */
  sponsored?: boolean;
  /** Quiet line under the name (e.g. Sponsored / Popular). */
  metaLabel?: string | null;
  /**
   * Butter-block fill override. Use cream on gold surfaces (trending banner)
   * so the stick doesn’t vanish into the same `#ffd700`.
   */
  butterColor?: string;
  /** Narrow carousel width (staples / trending). */
  compact?: boolean;
  index?: number;
  priceCents?: number | null;
  /** Hide grid copy while the in-place peek overlay is showing this product. */
  isPeekSource?: boolean;
  onPress: () => void;
  onLongPress?: (anchor: ProductPeekAnchor) => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function setPressScale(sv: SharedValue<number>, to: number, duration: number) {
  'worklet';
  sv.value = withTiming(to, { duration });
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Butter-block product pod: shiny block + square photo + name/price/add.
 * Soft press scale; long-press opens peek; haptics only on add/qty.
 */
export function ProductCard({
  product,
  saleBadge,
  compareAtCents,
  savingsLabel,
  priceNote,
  showSnap,
  quantityOnList,
  sponsored,
  metaLabel,
  butterColor,
  compact,
  priceCents,
  isPeekSource,
  onPress,
  onLongPress,
  onAdd,
  onIncrement,
  onDecrement,
}: Props) {
  const theme = useTheme();
  const rootRef = useRef<RNView>(null);
  const onList = quantityOnList != null && quantityOnList > 0;
  const press = useSharedValue(1);
  const resolvedMeta = metaLabel ?? (sponsored ? 'Sponsored' : null);

  const handleLongPress = () => {
    if (!onLongPress) return;
    if (!rootRef.current) {
      // Zero-size anchor → peek falls back to a centered fade.
      onLongPress({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    rootRef.current.measureInWindow((x, y, width, height) => {
      onLongPress({ x, y, width, height });
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));

  const blockColor =
    butterColor ?? (onList ? theme.backgroundSelected : theme.accentSoft);
  const blockSize = compact ? 112 : 128;
  const photoSize = Math.round(blockSize * 0.7);
  const title = productCardName(product);
  const showCompare =
    compareAtCents != null && priceCents != null && compareAtCents > priceCents;

  return (
    <AnimatedPressable
      ref={rootRef}
      onPress={onPress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      delayLongPress={400}
      onPressIn={() => setPressScale(press, 0.97, 90)}
      onPressOut={() => setPressScale(press, 1, 140)}
      style={[
        styles.card,
        compact && styles.cardCompact,
        isPeekSource && styles.peekSource,
        animatedStyle,
      ]}
      pointerEvents={isPeekSource ? 'none' : 'auto'}
      accessibilityRole="button"
      accessibilityLabel={title}>
      <View style={styles.blockStage}>
        <ButterBlock size={blockSize} color={blockColor}>
          <ProductPhoto
            imagePath={product.image_path}
            placeholderLetter={title}
            size={photoSize}
          />
        </ButterBlock>
        {saleBadge ? (
          <View style={[styles.saleMark, { backgroundColor: theme.primary }]}>
            <ThemedText type="smallBold" style={{ color: theme.primaryText, fontSize: 11 }}>
              {saleBadge}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <ThemedText type="smallBold" numberOfLines={2} style={styles.name}>
            {title}
          </ThemedText>
          {showSnap ? <SnapBadge size="sm" /> : null}
        </View>
        {resolvedMeta ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {resolvedMeta}
          </ThemedText>
        ) : null}

        {onList ? (
          <View style={styles.onListBlock}>
            {showCompare ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.compareAt}>
                {formatPrice(compareAtCents!)}
              </ThemedText>
            ) : null}
            {priceCents != null ? (
              <ThemedText type="smallBold" style={styles.price}>
                {formatPrice(priceCents)}
              </ThemedText>
            ) : null}
            {savingsLabel ? (
              <ThemedText type="smallBold" style={[styles.savings, { color: theme.primaryDark }]}>
                {savingsLabel}
              </ThemedText>
            ) : priceNote ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.priceNote}>
                {priceNote}
              </ThemedText>
            ) : null}
            <View
              style={[
                styles.stepper,
                {
                  backgroundColor: theme.backgroundSelected,
                  borderColor: theme.border,
                },
              ]}>
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onDecrement();
                }}
                hitSlop={8}
                style={styles.stepBtn}>
                <ThemedText type="smallBold">−</ThemedText>
              </Pressable>
              <ThemedText type="smallBold">{quantityOnList}</ThemedText>
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onIncrement();
                }}
                hitSlop={8}
                style={styles.stepBtn}>
                <ThemedText type="smallBold">+</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.priceCol}>
            {showCompare ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.compareAt}>
                {formatPrice(compareAtCents!)}
              </ThemedText>
            ) : null}
            <View style={styles.priceRow}>
              {priceCents != null ? (
                <ThemedText type="smallBold" style={styles.price}>
                  {formatPrice(priceCents)}
                </ThemedText>
              ) : (
                <View style={styles.priceSpacer} />
              )}
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onAdd();
                }}
                style={styles.addBtn}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Add to list">
                <ThemedText
                  type="smallBold"
                  style={{ color: theme.text, fontFamily: Fonts.sansBold, fontSize: 20, lineHeight: 22 }}>
                  +
                </ThemedText>
              </Pressable>
            </View>
            {savingsLabel ? (
              <ThemedText type="smallBold" style={[styles.savings, { color: theme.primaryDark }]}>
                {savingsLabel}
              </ThemedText>
            ) : priceNote ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.priceNote}>
                {priceNote}
              </ThemedText>
            ) : null}
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    minHeight: 172,
  },
  cardCompact: {
    width: 128,
    flex: 0,
    minHeight: 168,
  },
  peekSource: {
    opacity: 0,
  },
  blockStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleMark: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.two,
    zIndex: 2,
    maxWidth: '88%',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
  },
  body: {
    gap: Spacing.one,
    flex: 1,
    paddingHorizontal: Spacing.one,
    justifyContent: 'space-between',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  name: {
    flex: 1,
    lineHeight: 18,
  },
  meta: {
    fontSize: 11,
    lineHeight: 14,
  },
  priceCol: {
    gap: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 28,
  },
  price: {
    fontSize: 15,
    lineHeight: 20,
  },
  compareAt: {
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  savings: {
    fontSize: 12,
  },
  priceNote: {
    fontSize: 11,
  },
  priceSpacer: {
    flex: 1,
  },
  onListBlock: {
    gap: Spacing.one,
  },
  addBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.one,
    minHeight: 36,
  },
  stepBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
