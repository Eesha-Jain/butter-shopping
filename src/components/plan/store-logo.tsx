import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { storeLogoUrl } from '@/components/plan/store-logos';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  storeName: string | null | undefined;
  size?: number;
  /** Shows a muted "?" instead of a storefront when there's no store. */
  unknown?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Round chain logo on white; storefront glyph when the chain isn't recognized. */
export function StoreLogo({ storeName, size = 36, unknown = false, style }: Props) {
  const theme = useTheme();
  const url = unknown ? null : storeLogoUrl(storeName);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = url != null && failedUrl !== url;

  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: theme.border,
  };

  if (showLogo) {
    return (
      <View style={[styles.frame, frame, styles.logoBg, style]}>
        <Image
          source={{ uri: url }}
          style={{ width: size * 0.72, height: size * 0.72 }}
          contentFit="contain"
          cachePolicy="disk"
          transition={120}
          accessibilityIgnoresInvertColors
          onError={() => setFailedUrl(url)}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.frame,
        frame,
        { backgroundColor: unknown ? theme.backgroundElement : theme.secondary },
        style,
      ]}>
      <SymbolView
        name={
          unknown
            ? { ios: 'questionmark', android: 'help', web: 'help' }
            : { ios: 'storefront.fill', android: 'storefront', web: 'storefront' }
        }
        size={size * 0.5}
        tintColor={unknown ? theme.textSecondary : theme.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  logoBg: {
    backgroundColor: '#fff',
  },
});
