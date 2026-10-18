import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Product } from '@/backend';
import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
          backgroundColor: theme.backgroundElement,
          borderColor: onList ? theme.primary : 'transparent',
          borderWidth: onList ? 1.5 : 0,
        },
      ]}>
      <View style={[styles.imageWrap, compact && styles.imageWrapCompact]}>
        {saleBadge ? (
          <View style={[styles.badge, { backgroundColor: theme.primary }]}>
            <ThemedText type="small" style={{ color: theme.primaryText }}>
              {saleBadge}
            </ThemedText>
          </View>
        ) : null}
        {onToggleFavorite ? (
          <Pressable
            onPress={onToggleFavorite}
            hitSlop={8}
            style={[styles.heartBtn, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold" style={{ color: favorited ? theme.error : theme.textSecondary }}>
              {favorited ? '♥' : '♡'}
            </ThemedText>
          </Pressable>
        ) : null}
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: theme.backgroundSelected }]} />
        )}
      </View>
      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {product.name}
        </ThemedText>
        {product.brand ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {product.brand}
          </ThemedText>
        ) : null}
        {priceCents != null ? (
          <ThemedText type="smallBold">${(priceCents / 100).toFixed(2)}</ThemedText>
        ) : null}
        {sponsored ? (
          <ThemedText type="small" themeColor="textSecondary">
            Sponsored
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.actions}>
        {onList ? (
          <View style={[styles.stepper, { backgroundColor: theme.primary }]}>
            <Pressable onPress={onDecrement} hitSlop={8} style={styles.stepBtn}>
              <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                −
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
              {quantityOnList}
            </ThemedText>
            <Pressable onPress={onIncrement} hitSlop={8} style={styles.stepBtn}>
              <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                +
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onAdd}
            style={[styles.addBtn, { backgroundColor: theme.primary }]}
            hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
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
    borderRadius: Spacing.three,
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
    borderRadius: Spacing.two,
    overflow: 'hidden',
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
  },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
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
  },
  body: {
    gap: 2,
    flex: 1,
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
