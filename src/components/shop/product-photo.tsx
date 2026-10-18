import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type Props = {
  imagePath: string | null | undefined;
  /** Fallback letter when no image (usually product name initial). */
  placeholderLetter?: string;
  size?: number;
  /** Well fill — transparent so ButterBlock shows through, or match block color. */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Square contain photo well for butter-block pods — readable packaging, no ink frame.
 */
export function ProductPhoto({
  imagePath,
  placeholderLetter = '?',
  size = 84,
  backgroundColor = 'transparent',
  style,
}: Props) {
  const imageUrl = publicImageUrl('public-assets', imagePath ?? null);
  const radius = Math.min(14, size * 0.14);

  return (
    <View
      style={[
        styles.well,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor,
        },
        style,
      ]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} contentFit="contain" />
      ) : (
        <View style={styles.placeholder}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {placeholderLetter.slice(0, 1).toUpperCase()}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.one,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
