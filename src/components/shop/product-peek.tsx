import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Product } from '@/backend';
import {
  computeExpandedPeekRect,
  isValidPeekAnchor,
  PEEK_DEFAULT_HEIGHT,
  type ProductPeekAnchor,
} from '@/components/shop/product-peek-layout';
import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { ButterBlock } from '@/components/ui/butter-block';
import { Fonts, Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product | null;
  visible: boolean;
  anchor: ProductPeekAnchor | null;
  compact?: boolean;
  saleBadge?: string | null;
  priceCents?: number | null;
  quantityOnList?: number;
  onClose: () => void;
  onOpenFull: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

const SPRING = { damping: 18, stiffness: 280, mass: 0.9 };
const CLOSE_MS = 220;
const HERO_END = 168;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * In-place expand peek — morphs from the long-pressed card frame, clamped to screen edges.
 */
export function ProductPeek({
  product,
  visible,
  anchor,
  compact,
  saleBadge,
  priceCents,
  quantityOnList,
  onClose,
  onOpenFull,
  onAdd,
  onIncrement,
  onDecrement,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const onList = quantityOnList != null && quantityOnList > 0;

  // Keeps the last product rendered through the collapse after the parent clears it.
  const [displayProduct, setDisplayProduct] = useState<Product | null>(null);
  if (visible && product && product !== displayProduct) {
    setDisplayProduct(product);
  }
  const [contentHeight, setContentHeight] = useState(PEEK_DEFAULT_HEIGHT);
  const closingRef = useRef(false);
  const openedIdRef = useRef<string | null>(null);
  const openFullPendingRef = useRef(false);

  const progress = useSharedValue(0);
  const fadeOnly = useSharedValue(false);
  const fromRect = useSharedValue<ProductPeekAnchor>({ x: 0, y: 0, width: 1, height: 1 });
  const toRect = useSharedValue<ProductPeekAnchor>({
    x: 0,
    y: 0,
    width: 340,
    height: PEEK_DEFAULT_HEIGHT,
  });

  const heroStart = compact ? 112 : 128;

  const targetRect = useMemo(() => {
    if (!isValidPeekAnchor(anchor)) {
      const w = Math.min(340, windowWidth - Spacing.four * 2);
      const h = contentHeight;
      return {
        x: (windowWidth - w) / 2,
        y: (windowHeight - h) / 2,
        width: w,
        height: h,
      };
    }
    return computeExpandedPeekRect(
      anchor,
      { width: windowWidth, height: windowHeight },
      insets,
      contentHeight,
    );
  }, [anchor, windowWidth, windowHeight, insets, contentHeight]);

  const finishClose = useCallback(() => {
    closingRef.current = false;
    openedIdRef.current = null;
    setDisplayProduct(null);
    if (openFullPendingRef.current) {
      openFullPendingRef.current = false;
      onOpenFull();
    }
    onClose();
  }, [onClose, onOpenFull]);

  const animateClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    progress.set(
      withTiming(0, { duration: CLOSE_MS }, (finished) => {
        if (finished) {
          runOnJS(finishClose)();
        }
      }),
    );
  }, [finishClose, progress]);

  // Parent cleared the product externally — still collapse before unmounting.
  useEffect(() => {
    if (!visible && displayProduct && !closingRef.current) {
      animateClose();
    }
  }, [visible, displayProduct, animateClose]);

  // Start the open spring once per product; later rect changes (content measure) only retarget.
  useEffect(() => {
    if (!visible || !displayProduct || closingRef.current) return;
    const hasAnchor = isValidPeekAnchor(anchor);
    fadeOnly.set(!hasAnchor);
    fromRect.set(hasAnchor ? anchor : targetRect);
    toRect.set(targetRect);
    if (openedIdRef.current !== displayProduct.id) {
      openedIdRef.current = displayProduct.id;
      progress.set(0);
      progress.set(withSpring(1, SPRING));
    }
  }, [visible, displayProduct, anchor, targetRect, fadeOnly, fromRect, toRect, progress]);

  const handleSeeMore = useCallback(() => {
    openFullPendingRef.current = true;
    animateClose();
  }, [animateClose]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const panelStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const from = fromRect.get();
    const to = toRect.get();
    return {
      position: 'absolute',
      left: interpolate(p, [0, 1], [from.x, to.x], Extrapolation.CLAMP),
      top: interpolate(p, [0, 1], [from.y, to.y], Extrapolation.CLAMP),
      // Size may overshoot slightly with the spring for a "grow" feel.
      width: interpolate(p, [0, 1], [from.width, to.width]),
      height: interpolate(p, [0, 1], [from.height, to.height]),
      borderRadius: interpolate(p, [0, 1], [Spacing.two, Radius.sheet], Extrapolation.CLAMP),
      opacity: fadeOnly.get() ? interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP) : 1,
      overflow: 'hidden' as const,
    };
  });

  const heroWrapStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      progress.get(),
      [0, 1],
      [heroStart / HERO_END, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scale }] };
  });

  const seeMoreStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.55, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const peekProduct = displayProduct;
  if (!peekProduct) return null;

  const innerWidth = targetRect.width - Spacing.four * 2;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={animateClose}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { backgroundColor: SheetChrome.scrim }, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={animateClose}
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        <Animated.View
          style={[
            panelStyle,
            styles.card,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
            },
          ]}>
          <View
            style={[styles.cardInner, { width: innerWidth }]}
            onLayout={(e) => {
              const h = Math.ceil(e.nativeEvent.layout.height) + Spacing.four * 2;
              if (h > 0 && Math.abs(h - contentHeight) > 2) {
                setContentHeight(h);
              }
            }}>
            <Animated.View style={[styles.hero, heroWrapStyle]}>
              <ButterBlock size={HERO_END} color={onList ? theme.backgroundSelected : theme.accentSoft}>
                <ProductPhoto
                  imagePath={peekProduct.image_path}
                  placeholderLetter={peekProduct.name}
                  size={120}
                />
              </ButterBlock>
              {saleBadge ? (
                <View style={[styles.saleMark, { backgroundColor: theme.primary }]}>
                  <ThemedText type="smallBold" style={{ color: theme.primaryText, fontSize: 11 }}>
                    {saleBadge}
                  </ThemedText>
                </View>
              ) : null}
            </Animated.View>

            <ThemedText type="smallBold" style={styles.name}>
              {peekProduct.name}
            </ThemedText>
            {peekProduct.brand ? (
              <ThemedText type="small" themeColor="textSecondary">
                {peekProduct.brand}
              </ThemedText>
            ) : null}

            {onList ? (
              <View style={styles.onListBlock}>
                {priceCents != null ? (
                  <ThemedText type="smallBold" style={styles.price}>
                    {formatPrice(priceCents)}
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
                  <ThemedText type="smallBold">{quantityOnList} on list</ThemedText>
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
                  style={[styles.addBtn, { borderColor: theme.border }]}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Add to list">
                  <ThemedText
                    type="smallBold"
                    style={{ color: theme.text, fontFamily: Fonts.sansBold, fontSize: 18 }}>
                    +
                  </ThemedText>
                </Pressable>
              </View>
            )}

            <Animated.View style={seeMoreStyle}>
              <Pressable onPress={handleSeeMore} hitSlop={8} style={styles.seeMore}>
                <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
                  See more
                </ThemedText>
              </Pressable>
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    // Inner content is laid out at final width; centering lets it overflow evenly while the panel grows.
    alignItems: 'center',
    zIndex: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  cardInner: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  saleMark: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
  },
  name: {
    fontSize: Type.section,
    lineHeight: 28,
    textAlign: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: Spacing.two,
    minHeight: 32,
    marginTop: Spacing.one,
  },
  price: {
    fontSize: 18,
  },
  priceSpacer: {
    flex: 1,
  },
  onListBlock: {
    alignSelf: 'stretch',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    minHeight: 40,
  },
  stepBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeMore: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.one,
  },
});

export type { ProductPeekAnchor } from '@/components/shop/product-peek-layout';
