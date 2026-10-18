import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Product, SessionFoodRule } from '@/backend';
import type { Promotion } from '@/backend/types';
import { ProductDetailBody } from '@/components/shop/product-detail-body';
import {
  computeExpandedPeekRect,
  isValidPeekAnchor,
  PEEK_DEFAULT_HEIGHT,
  PEEK_MAX_WIDTH,
  type ProductPeekAnchor,
} from '@/components/shop/product-peek-layout';
import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { ButterBlock } from '@/components/ui/butter-block';
import { ButterButton } from '@/components/ui/butter-button';
import { Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product | null;
  visible: boolean;
  anchor: ProductPeekAnchor | null;
  compact?: boolean;
  saleBadge?: string | null;
  promotion?: Promotion | null;
  preferenceRules?: SessionFoodRule[];
  quantityOnList?: number;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  onClose: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

const SPRING = { damping: 18, stiffness: 280, mass: 0.9 };
const CLOSE_MS = 220;
const RETARGET_MS = 220;
const HERO_END = 144;
const MAX_HEIGHT_RATIO = 0.85;

/**
 * Product popup — morphs from the pressed card frame into a scrollable detail panel,
 * clamped to screen edges.
 */
export function ProductPeek({
  product,
  visible,
  anchor,
  compact,
  saleBadge,
  promotion,
  preferenceRules,
  quantityOnList,
  favorited,
  onToggleFavorite,
  onClose,
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
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const closingRef = useRef(false);
  const openedIdRef = useRef<string | null>(null);

  const progress = useSharedValue(0);
  const fadeOnly = useSharedValue(false);
  const fromRect = useSharedValue<ProductPeekAnchor>({ x: 0, y: 0, width: 1, height: 1 });
  const toX = useSharedValue(0);
  const toY = useSharedValue(0);
  const toW = useSharedValue(PEEK_MAX_WIDTH);
  const toH = useSharedValue(PEEK_DEFAULT_HEIGHT);

  const heroStart = compact ? 112 : 128;

  const contentHeight =
    scrollContentHeight > 0
      ? Math.min(scrollContentHeight + footerHeight, windowHeight * MAX_HEIGHT_RATIO)
      : PEEK_DEFAULT_HEIGHT;

  const targetRect = useMemo(() => {
    if (!isValidPeekAnchor(anchor)) {
      const w = Math.min(PEEK_MAX_WIDTH, windowWidth - Spacing.four * 2);
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
    setScrollContentHeight(0);
    onClose();
  }, [onClose]);

  const animateClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Clamp any spring overshoot so the collapse starts from the settled frame (no jump).
    if (progress.get() > 1) progress.set(1);
    progress.set(
      withTiming(0, { duration: CLOSE_MS, easing: Easing.inOut(Easing.cubic) }, (finished) => {
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

  // Open spring runs once per product; later size changes (offers loading) ease to the new frame.
  useEffect(() => {
    if (!visible || !displayProduct || closingRef.current) return;
    const firstOpen = openedIdRef.current !== displayProduct.id;
    if (firstOpen) {
      const hasAnchor = isValidPeekAnchor(anchor);
      fadeOnly.set(!hasAnchor);
      fromRect.set(hasAnchor ? anchor : targetRect);
      toX.set(targetRect.x);
      toY.set(targetRect.y);
      toW.set(targetRect.width);
      toH.set(targetRect.height);
      openedIdRef.current = displayProduct.id;
      progress.set(0);
      progress.set(withSpring(1, SPRING));
    } else {
      const ease = { duration: RETARGET_MS };
      toX.set(withTiming(targetRect.x, ease));
      toY.set(withTiming(targetRect.y, ease));
      toW.set(withTiming(targetRect.width, ease));
      toH.set(withTiming(targetRect.height, ease));
    }
  }, [
    visible,
    displayProduct,
    anchor,
    targetRect,
    fadeOnly,
    fromRect,
    toX,
    toY,
    toW,
    toH,
    progress,
  ]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const panelStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const from = fromRect.get();
    return {
      position: 'absolute',
      left: interpolate(p, [0, 1], [from.x, toX.get()], Extrapolation.CLAMP),
      top: interpolate(p, [0, 1], [from.y, toY.get()], Extrapolation.CLAMP),
      // Size may overshoot slightly with the spring for a "grow" feel.
      width: interpolate(p, [0, 1], [from.width, toW.get()]),
      height: interpolate(p, [0, 1], [from.height, toH.get()]),
      borderRadius: interpolate(p, [0, 1], [Spacing.two, Radius.sheet], Extrapolation.CLAMP),
      // The source card stays hidden until close finishes, so keep the panel opaque almost to the end.
      opacity: fadeOnly.get()
        ? interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP)
        : interpolate(p, [0, 0.04], [0, 1], Extrapolation.CLAMP),
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

  const detailsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(),     [0.4, 0.9], [0, 1], Extrapolation.CLAMP),
  }));

  const peekProduct = displayProduct;
  if (!peekProduct) return null;

  const innerWidth = targetRect.width;

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
          <View style={[styles.cardInner, { width: innerWidth }]}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
              onContentSizeChange={(_w, h) => {
                const next = Math.ceil(h);
                if (Math.abs(next - scrollContentHeight) > 2) setScrollContentHeight(next);
              }}>
              <Animated.View style={[styles.hero, heroWrapStyle]}>
                <ButterBlock
                  size={HERO_END}
                  color={onList ? theme.backgroundSelected : theme.accentSoft}>
                  <ProductPhoto
                    imagePath={peekProduct.image_path}
                    placeholderLetter={peekProduct.name}
                    size={104}
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

              <View style={styles.titleRow}>
                <View style={styles.titleText}>
                  <ThemedText type="smallBold" style={styles.name}>
                    {peekProduct.name}
                  </ThemedText>
                  {peekProduct.brand ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {peekProduct.brand}
                    </ThemedText>
                  ) : null}
                </View>
                {onToggleFavorite ? (
                  <Pressable
                    onPress={onToggleFavorite}
                    hitSlop={8}
                    style={styles.heartBtn}
                    accessibilityRole="button"
                    accessibilityLabel={favorited ? 'Remove from favorites' : 'Add to favorites'}>
                    <SymbolView
                      name={favorited ? 'heart.fill' : 'heart'}
                      size={20}
                      tintColor={favorited ? theme.error : theme.textSecondary}
                    />
                  </Pressable>
                ) : null}
              </View>

              <Animated.View style={detailsStyle}>
                <ProductDetailBody
                  key={peekProduct.id}
                  product={peekProduct}
                  saleBadge={saleBadge}
                  promotion={promotion}
                  preferenceRules={preferenceRules}
                />
              </Animated.View>
            </ScrollView>

            <View
              style={[styles.footer, { borderTopColor: theme.border }]}
              onLayout={(e) => {
                const h = Math.ceil(e.nativeEvent.layout.height);
                if (Math.abs(h - footerHeight) > 2) setFooterHeight(h);
              }}>
              {onList ? (
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
              ) : (
                <ButterButton
                  label="Add to list"
                  variant="ink"
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onAdd();
                  }}
                />
              )}
            </View>
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
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  titleText: {
    flex: 1,
    gap: Spacing.half,
  },
  name: {
    fontSize: Type.section,
    lineHeight: 28,
  },
  heartBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  stepBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export type { ProductPeekAnchor } from '@/components/shop/product-peek-layout';
