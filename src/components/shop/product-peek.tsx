import * as Haptics from 'expo-haptics';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import type { Product } from '@/backend';
import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { ButterBlock } from '@/components/ui/butter-block';
import { Fonts, Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product | null;
  visible: boolean;
  saleBadge?: string | null;
  priceCents?: number | null;
  quantityOnList?: number;
  onClose: () => void;
  onOpenFull: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Messages-style stay-open peek — butter block hero, light details, See more → sheet.
 */
export function ProductPeek({
  product,
  visible,
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
  const onList = quantityOnList != null && quantityOnList > 0;

  if (!product) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(180)}
          style={[styles.backdrop, { backgroundColor: SheetChrome.scrim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(240).springify().damping(18)}
          exiting={FadeOut.duration(160)}
          style={[
            styles.card,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
            },
          ]}>
          <View style={styles.hero}>
            <ButterBlock size={168} color={onList ? theme.backgroundSelected : theme.accentSoft}>
              <ProductPhoto
                imagePath={product.image_path}
                placeholderLetter={product.name}
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
          </View>

          <ThemedText type="smallBold" style={styles.name}>
            {product.name}
          </ThemedText>
          {product.brand ? (
            <ThemedText type="small" themeColor="textSecondary">
              {product.brand}
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

          <Pressable onPress={onOpenFull} hitSlop={8} style={styles.seeMore}>
            <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
              See more
            </ThemedText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
    zIndex: 1,
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
