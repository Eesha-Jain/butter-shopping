import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';

import type { Product } from '@/backend';
import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  product: Product;
  index?: number;
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

/**
 * Organic silhouettes. Product photo is clipped to the same path so it fills
 * the blob size/shape. A slightly larger colored underlay keeps the outline readable.
 */
const BLOB_SHAPES: BlobShape[] = [
  {
    path: 'M18 52C16 32 34 18 58 18C82 18 104 28 108 48C112 68 96 84 72 88C46 92 20 82 18 52Z',
    scale: 1.22,
    rotation: -7,
    translateY: 14,
  },
  {
    path: 'M20 46C28 30 38 28 50 22C62 16 70 24 82 26C98 28 110 38 106 54C102 68 88 70 80 82C70 96 54 88 42 84C28 80 12 68 20 46Z',
    scale: 1.2,
    rotation: 5,
    translateY: 7,
  },
  {
    path: 'M24 34C40 18 74 14 92 28C108 40 112 66 98 80C84 94 56 90 38 82C20 74 12 48 24 34Z',
    scale: 1.18,
    rotation: -10,
    translateY: 10,
  },
  {
    path: 'M14 48C18 26 42 18 64 20C88 22 108 34 108 52C108 72 88 82 64 82C40 82 10 72 14 48Z',
    scale: 1.21,
    rotation: 2,
    translateY: -5,
  },
  {
    path: 'M30 18C46 12 58 24 76 20C94 16 108 28 104 46C100 62 108 76 92 86C76 96 62 82 48 82C30 82 18 66 22 48C24 36 18 24 30 18Z',
    scale: 1.22,
    rotation: 8,
    translateY: 8,
  },
  {
    path: 'M22 28C38 16 52 26 68 22C84 18 100 24 108 40C116 56 104 66 96 78C86 92 70 82 56 84C38 86 22 78 18 62C14 48 12 36 22 28Z',
    scale: 1.2,
    rotation: -5,
    translateY: 2,
  },
  {
    path: 'M26 24C42 16 54 28 68 30C84 32 104 24 108 42C112 58 96 66 94 80C92 94 72 92 60 82C48 72 30 82 22 68C14 54 14 32 26 24Z',
    scale: 1.18,
    rotation: 12,
    translateY: -1,
  },
  {
    path: 'M22 42C28 28 44 30 54 20C64 10 76 22 82 32C90 44 108 44 104 60C100 76 82 78 70 86C56 96 42 84 30 78C16 70 16 54 22 42Z',
    scale: 1.21,
    rotation: -12,
    translateY: 6,
  },
  {
    path: 'M22 30C38 18 58 24 72 30C86 36 104 42 102 58C100 74 82 78 68 80C50 82 30 78 22 64C16 54 12 38 22 30Z',
    scale: 1.24,
    rotation: 4,
    translateY: 0,
  },
  {
    path: 'M28 24C42 18 50 30 64 28C80 26 92 16 102 30C112 44 98 56 94 68C90 82 74 88 60 82C46 76 30 86 22 72C14 58 14 32 28 24Z',
    scale: 1.2,
    rotation: -8,
    translateY: 5,
  },
  {
    path: 'M20 48C28 38 40 42 48 30C56 18 70 20 78 32C86 44 104 42 106 56C108 70 92 78 78 80C64 82 54 94 42 84C32 76 16 72 20 48Z',
    scale: 1.19,
    rotation: 7,
    translateY: 4,
  },
  {
    path: 'M26 26C42 18 54 26 66 24C82 22 100 30 102 44C104 58 94 66 84 74C72 84 60 76 48 82C34 88 20 76 20 62C20 48 14 32 26 26Z',
    scale: 1.19,
    rotation: -3,
    translateY: 3,
  },
];

const STAGE_SIZE = 148;
const VIEWBOX = 128;
const CLIP_ID_PREFIX = 'trending-blob-clip';

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
  const clipId = `${CLIP_ID_PREFIX}-${product.id}`;

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onPress} style={styles.press}>
        <View style={styles.blobStage}>
          <Svg
            width={STAGE_SIZE}
            height={STAGE_SIZE}
            viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
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
            <Defs>
              <ClipPath id={clipId}>
                <Path d={shape.path} />
              </ClipPath>
            </Defs>
            {/* Slightly larger colored underlay so the silhouette stays readable. */}
            <Path
              d={shape.path}
              fill={theme.secondary}
              transform={`translate(${VIEWBOX / 2} ${VIEWBOX / 2}) scale(1.06) translate(${-VIEWBOX / 2} ${-VIEWBOX / 2})`}
            />
            {imageUrl ? (
              <SvgImage
                href={imageUrl}
                x={0}
                y={0}
                width={VIEWBOX}
                height={VIEWBOX}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
              />
            ) : (
              <Path d={shape.path} fill={theme.backgroundSelected} />
            )}
          </Svg>

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
              style={[styles.heartBtn, { backgroundColor: theme.background }]}
            >
              <ThemedText
                type="smallBold"
                style={{ color: favorited ? theme.error : theme.textSecondary }}
              >
                {favorited ? '♥' : '♡'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ThemedText type="smallBold" numberOfLines={2} style={styles.name}>
          {product.name}
        </ThemedText>

        {priceCents != null ? (
          <ThemedText type="smallBold" style={styles.price}>
            ${(priceCents / 100).toFixed(2)}
          </ThemedText>
        ) : null}

        {sponsored ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.sponsored}>
            Sponsored
          </ThemedText>
        ) : null}
      </Pressable>

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
            hitSlop={8}
          >
            <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
              +
            </ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: STAGE_SIZE,
    gap: Spacing.two,
  },
  press: {
    gap: Spacing.one,
  },
  blobStage: {
    width: STAGE_SIZE,
    height: STAGE_SIZE,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: STAGE_SIZE,
    height: STAGE_SIZE,
    zIndex: 0,
  },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
  },
  heartBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    textAlign: 'center',
    minHeight: 36,
  },
  price: {
    textAlign: 'center',
  },
  sponsored: {
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center',
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
