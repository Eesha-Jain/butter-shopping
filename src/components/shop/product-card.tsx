import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { Product } from '@/backend';
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
  sponsored?: boolean;
  /** Narrow carousel width (staples / trending). */
  compact?: boolean;
  index?: number;
  priceCents?: number | null;
  onPress: () => void;
  onLongPress?: () => void;
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
  quantityOnList,
  sponsored,
  compact,
  priceCents,
  onPress,
  onLongPress,
  onAdd,
  onIncrement,
  onDecrement,
}: Props) {
  const theme = useTheme();
  const onList = quantityOnList != null && quantityOnList > 0;
  const press = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));

  const blockColor = onList ? theme.backgroundSelected : theme.accentSoft;
  const blockSize = compact ? 140 : 160;
  const photoSize = Math.round(blockSize * 0.72);
  const showCompare =
    compareAtCents != null && priceCents != null && compareAtCents > priceCents;

  const priceBlock = (
    <View style={styles.priceStack}>
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
    </View>
  );

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      onPressIn={() => setPressScale(press, 0.97, 90)}
      onPressOut={() => setPressScale(press, 1, 140)}
      style={[styles.card, compact && styles.cardCompact, animatedStyle]}
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
        {sponsored ? (
          <ThemedText type="small" themeColor="textSecondary">
            Sponsored
          </ThemedText>
        ) : null}

        {onList ? (
          <View style={styles.onListBlock}>
            {priceCents != null || savingsLabel || priceNote ? priceBlock : null}
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
          <View style={styles.priceRow}>
            {priceCents != null || savingsLabel || priceNote ? (
              priceBlock
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
                style={{ color: theme.text, fontFamily: Fonts.sansBold, fontSize: 22 }}>
                +
              </ThemedText>
            </Pressable>
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
    minHeight: 200,
  },
  cardCompact: {
    width: 156,
    flex: 0,
    minHeight: 188,
  },
  blockStage: {
    alignItems: 'center',
    justifyContent: 'center',
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 32,
  },
  priceStack: {
    flexShrink: 1,
    gap: 1,
  },
  price: {
    fontSize: 15,
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
    width: 36,
    height: 36,
    borderRadius: 18,
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
