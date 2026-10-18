import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Product } from '@/backend';
import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product;
  saleBadge?: string | null;
  quantityOnList?: number;
  sponsored?: boolean;
  compact?: boolean;
  favorited?: boolean;
  priceCents?: number | null;
  onPress: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onToggleFavorite?: () => void;
};

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function ProductCard({
  product,
  saleBadge,
  quantityOnList,
  sponsored,
  compact,
  favorited,
  priceCents,
  onPress,
  onAdd,
  onIncrement,
  onDecrement,
  onToggleFavorite,
}: Props) {
  const theme = useTheme();
  const imageUrl = publicImageUrl('public-assets', product.image_path);
  const onList = quantityOnList != null && quantityOnList > 0;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        compact && styles.cardCompact,
        {
          backgroundColor: theme.background,
          borderColor: onList ? theme.secondary : theme.borderInk,
          borderWidth: onList ? 2.5 : 2,
        },
      ]}>
      <View
        style={[
          styles.imageWrap,
          compact && styles.imageWrapCompact,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        {saleBadge ? (
          <View style={[styles.badge, { backgroundColor: theme.primary, borderColor: theme.borderInk }]}>
            <ThemedText type="smallBold" style={{ color: theme.primaryText, fontSize: 11 }}>
              {saleBadge}
            </ThemedText>
          </View>
        ) : null}
        {onToggleFavorite ? (
          <Pressable
            onPress={onToggleFavorite}
            hitSlop={8}
            style={[styles.heartBtn, { backgroundColor: theme.background, borderColor: theme.borderInk }]}>
            <SymbolView
              name={favorited ? 'heart.fill' : 'heart'}
              size={14}
              tintColor={favorited ? theme.error : theme.textSecondary}
            />
          </Pressable>
        ) : null}
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} contentFit="contain" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {product.name.slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={2} style={styles.name}>
          {product.name}
        </ThemedText>
        <View style={styles.metaRow}>
          {product.brand ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.brand}>
              {product.brand}
            </ThemedText>
          ) : null}
          {priceCents != null ? (
            <ThemedText type="smallBold" style={styles.price}>
              {product.brand ? ' · ' : ''}
              {formatPrice(priceCents)}
            </ThemedText>
          ) : null}
        </View>
        {sponsored ? (
          <ThemedText type="small" themeColor="textSecondary">
            Sponsored
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.actions}>
        {onList ? (
          <View
            style={[
              styles.stepper,
              {
                backgroundColor: theme.backgroundSelected,
                borderColor: theme.borderInk,
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
        ) : (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onAdd();
            }}
            style={[styles.addBtn, { backgroundColor: theme.secondary }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add to list">
            <ThemedText type="smallBold" style={{ color: theme.primary, fontFamily: Fonts.sansBold }}>
              +
            </ThemedText>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: Radius.card,
    padding: Spacing.two,
    gap: Spacing.two,
    minHeight: 180,
  },
  cardCompact: {
    width: 148,
    flex: 0,
    minHeight: 168,
  },
  imageWrap: {
    height: 96,
    borderRadius: Radius.button,
    overflow: 'hidden',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.one,
  },
  imageWrapCompact: {
    height: 80,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
    borderWidth: 1.5,
  },
  heartBtn: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    zIndex: 1,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  body: {
    gap: 2,
    flex: 1,
  },
  name: {
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  brand: {
    flexShrink: 1,
  },
  price: {
    fontSize: 15,
  },
  actions: {
    alignItems: 'flex-end',
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
    borderRadius: 18,
    borderWidth: 2,
    paddingHorizontal: Spacing.one,
    gap: Spacing.two,
    minHeight: 36,
  },
  stepBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
