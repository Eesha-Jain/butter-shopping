import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { Product } from '@/backend';
import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product;
  index?: number;
  /** Promo badge (e.g. "20% off") — shown as sale chip, not instead of price. */
  saleBadge?: string | null;
  priceCents?: number | null;
  sponsored?: boolean;
  quantityOnList?: number;
  favorited?: boolean;
  onPress: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onToggleFavorite?: () => void;
};

type BlobShape = {
  path: string;
  scale: number;
  rotation: number;
  translateY: number;
};

/** Soft gold organic accents behind the photo — quieter cousin of the old black blobs. */
const BLOB_SHAPES: BlobShape[] = [
  {
    path: 'M18 52C16 32 34 18 58 18C82 18 104 28 108 48C112 68 96 84 72 88C46 92 20 82 18 52Z',
    scale: 1.12,
    rotation: -7,
    translateY: 6,
  },
  {
    path: 'M20 46C28 30 38 28 50 22C62 16 70 24 82 26C98 28 110 38 106 54C102 68 88 70 80 82C70 96 54 88 42 84C28 80 12 68 20 46Z',
    scale: 1.1,
    rotation: 5,
    translateY: 2,
  },
  {
    path: 'M24 34C40 18 74 14 92 28C108 40 112 66 98 80C84 94 56 90 38 82C20 74 12 48 24 34Z',
    scale: 1.1,
    rotation: -10,
    translateY: 4,
  },
  {
    path: 'M14 48C18 26 42 18 64 20C88 22 108 34 108 52C108 72 88 82 64 82C40 82 10 72 14 48Z',
    scale: 1.12,
    rotation: 2,
    translateY: -2,
  },
];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function TrendingBlobCard({
  product,
  index = 0,
  saleBadge,
  priceCents,
  sponsored,
  quantityOnList,
  favorited,
  onPress,
  onAdd,
  onIncrement,
  onDecrement,
  onToggleFavorite,
}: Props) {
  const theme = useTheme();
  const imageUrl = publicImageUrl('public-assets', product.image_path);
  const onList = quantityOnList != null && quantityOnList > 0;
  const shape = BLOB_SHAPES[index % BLOB_SHAPES.length];

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: theme.background,
          borderColor: onList ? theme.secondary : theme.borderInk,
          borderWidth: onList ? 2.5 : 2,
        },
      ]}>
      <View style={styles.blobStage}>
        <Svg
          width={132}
          height={100}
          viewBox="0 0 128 128"
          pointerEvents="none"
          style={[
            styles.blobSvg,
            {
              transform: [
                { translateY: shape.translateY },
                { rotate: `${shape.rotation}deg` },
                { scale: shape.scale },
              ],
            },
          ]}>
          <Path d={shape.path} fill={theme.accentSoft} />
        </Svg>

        <View
          style={[
            styles.photoClip,
            { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
          ]}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="contain" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {product.name.slice(0, 1).toUpperCase()}
              </ThemedText>
            </View>
          )}
        </View>

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
    width: 148,
    borderRadius: Radius.card,
    padding: Spacing.two,
    gap: Spacing.two,
    minHeight: 168,
  },
  blobStage: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobSvg: {
    position: 'absolute',
    zIndex: 0,
  },
  photoClip: {
    width: 84,
    height: 84,
    borderRadius: Radius.button,
    overflow: 'hidden',
    borderWidth: 2,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.one,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
    borderWidth: 1.5,
  },
  heartBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
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
