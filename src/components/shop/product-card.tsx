import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type View as RNView } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { Product } from '@/backend';
import type { ProductPeekAnchor } from '@/components/shop/product-peek-layout';
import { ProductPhoto } from '@/components/shop/product-photo';
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
  favorited?: boolean;
  onPress: (anchor: ProductPeekAnchor) => void;
  onLongPress?: (anchor: ProductPeekAnchor) => void;
  onDoubleTap?: () => void;
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
 * Soft press scale; double-tap favorites; long-press opens peek.
 */
export function ProductCard({
  product,
  saleBadge,
  compareAtCents,
  savingsLabel,
  priceNote,
  quantityOnList,
  sponsored,
  metaLabel,
  butterColor,
  compact,
  priceCents,
  isPeekSource,
  favorited = false,
  onPress,
  onLongPress,
  onDoubleTap,
  onAdd,
  onIncrement,
  onDecrement,
}: Props) {
  const theme = useTheme();
  const rootRef = useRef<RNView>(null);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onList = quantityOnList != null && quantityOnList > 0;
  const press = useSharedValue(1);
  const burstScale = useSharedValue(0);
  const burstOpacity = useSharedValue(0);
  const burstLift = useSharedValue(0);
  const burstTilt = useSharedValue(0);
  const burstRedOpacity = useSharedValue(1);
  const burstInkOpacity = useSharedValue(0);
  const [burstLiked, setBurstLiked] = useState(true);
  const resolvedMeta = metaLabel ?? (sponsored ? 'Sponsored' : null);

  useEffect(
    () => () => {
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    },
    [],
  );

  const withAnchor = (cb: (anchor: ProductPeekAnchor) => void) => {
    if (!rootRef.current) {
      // Zero-size anchor → peek falls back to a centered fade.
      cb({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    rootRef.current.measureInWindow((x, y, width, height) => {
      cb({ x, y, width, height });
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));

  const burstStyle = useAnimatedStyle(() => ({
    opacity: burstOpacity.get(),
    transform: [
      { translateY: burstLift.get() },
      { rotate: `${burstTilt.get()}deg` },
      { scale: burstScale.get() },
    ],
  }));
  const burstRedStyle = useAnimatedStyle(() => ({
    opacity: burstRedOpacity.get(),
  }));
  const burstInkStyle = useAnimatedStyle(() => ({
    opacity: burstInkOpacity.get(),
  }));

  // Instagram-style: pop past full size, settle, hold, then drift up and fade.
  const playBurst = (liking: boolean) => {
    setBurstLiked(liking);
    burstLift.set(0);
    burstRedOpacity.set(1);
    burstInkOpacity.set(0);
    if (liking) {
      burstTilt.set(Math.round(Math.random() * 24) - 12);
      burstScale.set(
        withSequence(
          withTiming(0, { duration: 0 }),
          withSpring(1.2, { damping: 9, stiffness: 320, mass: 0.6 }),
          withTiming(1, { duration: 110 }),
          withDelay(320, withTiming(0.85, { duration: 220 })),
        ),
      );
      burstOpacity.set(
        withSequence(
          withTiming(0.95, { duration: 90 }),
          withDelay(480, withTiming(0, { duration: 220 })),
        ),
      );
      burstLift.set(
        withDelay(
          560,
          withTiming(-14, { duration: 220, easing: Easing.out(Easing.quad) }),
        ),
      );
    } else {
      // The red heart cracks into an ink-colored heart before drifting away.
      burstTilt.set(-9);
      burstScale.set(
        withSequence(
          withTiming(0.65, { duration: 0 }),
          withSpring(1.08, { damping: 8, stiffness: 300, mass: 0.55 }),
          withTiming(0.94, { duration: 120 }),
          withDelay(120, withTiming(0.76, { duration: 240 })),
        ),
      );
      burstOpacity.set(
        withSequence(
          withTiming(1, { duration: 80 }),
          withDelay(430, withTiming(0, { duration: 240 })),
        ),
      );
      burstRedOpacity.set(
        withDelay(130, withTiming(0.12, { duration: 180, easing: Easing.out(Easing.quad) })),
      );
      burstInkOpacity.set(
        withSequence(
          withTiming(0, { duration: 0 }),
          withDelay(130, withTiming(0.9, { duration: 180, easing: Easing.out(Easing.quad) })),
          withDelay(250, withTiming(0, { duration: 230 })),
        ),
      );
      burstLift.set(
        withDelay(400, withTiming(-10, { duration: 260, easing: Easing.out(Easing.quad) })),
      );
    }
  };

  const blockColor =
    butterColor ?? (onList ? theme.backgroundSelected : theme.accentSoft);
  const blockSize = compact ? 112 : 128;
  const photoSize = Math.round(blockSize * 0.7);
  const showCompare =
    compareAtCents != null && priceCents != null && compareAtCents > priceCents;

  const handlePress = () => {
    if (!onDoubleTap) {
      withAnchor(onPress);
      return;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
      playBurst(!favorited);
      onDoubleTap();
      return;
    }
    tapTimeoutRef.current = setTimeout(() => {
      tapTimeoutRef.current = null;
      withAnchor(onPress);
    }, 280);
  };

  const handleLongPress = () => {
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (onLongPress) withAnchor(onLongPress);
  };

  return (
    <AnimatedPressable
      ref={rootRef}
      onPress={handlePress}
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
      accessibilityLabel={product.name}>
      <View style={styles.blockStage}>
        <ButterBlock size={blockSize} color={blockColor}>
          <ProductPhoto
            imagePath={product.image_path}
            placeholderLetter={product.name}
            size={photoSize}
          />
        </ButterBlock>
        <View
          pointerEvents="none"
          style={[
            styles.favoriteMark,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
            },
          ]}>
          <SymbolView
            name={favorited ? 'heart.fill' : 'heart'}
            size={14}
            tintColor={favorited ? theme.error : theme.textSecondary}
          />
        </View>
        <Animated.View pointerEvents="none" style={[styles.burst, burstStyle]}>
          <Animated.View style={burstRedStyle}>
            <SymbolView
              name="heart.fill"
              size={Math.round(blockSize * 0.42)}
              tintColor={theme.error}
            />
          </Animated.View>
          {!burstLiked ? (
            <Animated.View style={[styles.burstInk, burstInkStyle]}>
              <SymbolView
                name="heart.slash.fill"
                size={Math.round(blockSize * 0.42)}
                tintColor={theme.text}
              />
            </Animated.View>
          ) : null}
        </Animated.View>
        {saleBadge ? (
          <View style={[styles.saleMark, { backgroundColor: theme.primary }]}>
            <ThemedText type="smallBold" style={{ color: theme.primaryText, fontSize: 12 }}>
              {saleBadge}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={2} style={styles.name}>
          {product.name}
        </ThemedText>
        {resolvedMeta ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {resolvedMeta}
          </ThemedText>
        ) : null}

        {onList ? (
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
                <ThemedText type="smallBold" style={styles.stepQty}>
                  {quantityOnList}
                </ThemedText>
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
  burst: {
    position: 'absolute',
    zIndex: 3,
    opacity: 0,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  burstInk: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteMark: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two + 2,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  saleMark: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.two,
    zIndex: 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
  },
  body: {
    gap: Spacing.one,
    flex: 1,
    paddingHorizontal: Spacing.one,
    justifyContent: 'space-between',
  },
  name: {
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
  addBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 28,
  },
  stepQty: {
    minWidth: 14,
    textAlign: 'center',
  },
  stepBtn: {
    width: 24,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
