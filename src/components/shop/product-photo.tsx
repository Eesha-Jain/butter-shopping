import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { publicImageUrl } from '@/backend';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  imagePath: string | null | undefined;
  /** @deprecated Letter fallback replaced by bag icon — kept for call-site compat. */
  placeholderLetter?: string;
  size?: number;
  /** Well fill — transparent so ButterBlock shows through, or match block color. */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Square contain photo well for butter-block pods — readable packaging, no ink frame.
 * Missing art → small shopping-bag glyph.
 */
export function ProductPhoto({
  imagePath,
  size = 84,
  backgroundColor = 'transparent',
  style,
}: Props) {
  const theme = useTheme();
  const imageUrl = publicImageUrl('public-assets', imagePath ?? null);
  const radius = Math.min(14, size * 0.14);
  const iconSize = Math.max(22, Math.round(size * 0.38));

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
          <SymbolView
            name={
              {
                ios: 'bag.fill',
                android: 'shopping_bag',
                web: 'shopping_bag',
              } as ComponentProps<typeof SymbolView>['name']
            }
            size={iconSize}
            tintColor={theme.textSecondary}
          />
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
