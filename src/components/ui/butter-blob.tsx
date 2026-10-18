import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

type BlobShape = {
  path: string;
  scale: number;
  rotation: number;
  translateY: number;
};

/** Curated organic silhouettes — cow DNA without procedural noise. */
const BLOB_SHAPES: BlobShape[] = [
  {
    path: 'M18 52C16 32 34 18 58 18C82 18 104 28 108 48C112 68 96 84 72 88C46 92 20 82 18 52Z',
    scale: 1.12,
    rotation: -7,
    translateY: 4,
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
    translateY: 3,
  },
  {
    path: 'M14 48C18 26 42 18 64 20C88 22 108 34 108 52C108 72 88 82 64 82C40 82 10 72 14 48Z',
    scale: 1.12,
    rotation: 2,
    translateY: -2,
  },
  {
    path: 'M30 18C46 12 58 24 76 20C94 16 108 28 104 46C100 62 108 76 92 86C76 96 62 82 48 82C30 82 18 66 22 48C24 36 18 24 30 18Z',
    scale: 1.08,
    rotation: 8,
    translateY: 2,
  },
  {
    path: 'M22 28C38 16 52 26 68 22C84 18 100 24 108 40C116 56 104 66 96 78C86 92 70 82 56 84C38 86 22 78 18 62C14 48 12 36 22 28Z',
    scale: 1.1,
    rotation: -5,
    translateY: 1,
  },
];

export const BUTTER_BLOB_VARIANT_COUNT = BLOB_SHAPES.length;

/** Stable 0..n-1 from an arbitrary string (product id, etc.). */
export function blobVariantFromSeed(seed: string, count = BUTTER_BLOB_VARIANT_COUNT): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % count;
}

type Props = {
  /** Explicit shape index; ignored when `seed` is set. */
  variant?: number;
  /** Stable variant derived from id. */
  seed?: string;
  /** Stage width/height in px. */
  size?: number;
  color: string;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Soft organic SVG silhouette — cow brand DNA for product tiles / sheet heroes.
 * Sit the product photo on top; do not clip photos into the path.
 */
export function ButterBlob({
  variant = 0,
  seed,
  size = 120,
  color,
  opacity = 1,
  style,
}: Props) {
  const index =
    seed != null ? blobVariantFromSeed(seed) : ((variant % BLOB_SHAPES.length) + BLOB_SHAPES.length) % BLOB_SHAPES.length;
  const shape = BLOB_SHAPES[index];

  return (
    <View
      pointerEvents="none"
      style={[styles.stage, { width: size, height: size, opacity }, style]}
      accessibilityElementsHidden>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 128 128"
        style={{
          transform: [
            { translateY: shape.translateY * (size / 128) },
            { rotate: `${shape.rotation}deg` },
            { scale: shape.scale },
          ],
        }}>
        <Path d={shape.path} fill={color} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
