import * as Haptics from 'expo-haptics';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Props = {
  accessibilityLabel: string;
  onPress: () => void;
  /** SF Symbol name (iOS). */
  iosSymbol: string;
  /** Material symbol name (Android / web). */
  androidSymbol: string;
  style?: StyleProp<ViewStyle>;
};

function useGlassOnIos(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

/**
 * Toolbar icon control: liquid glass on supported iOS, Material tonal on Android,
 * light translucent fallback elsewhere. Avoids shipping iOS glass chrome on Android.
 */
export function NativeIconButton({
  accessibilityLabel,
  onPress,
  iosSymbol,
  androidSymbol,
  style,
}: Props) {
  const theme = useTheme();
  const glass = useGlassOnIos();

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const icon = (
    <SymbolView
      // Expo Symbols platform map — cast keeps call sites simple.
      name={
        {
          ios: iosSymbol,
          android: androidSymbol,
          web: androidSymbol,
        } as React.ComponentProps<typeof SymbolView>['name']
      }
      size={20}
      tintColor={theme.text}
    />
  );

  if (glass) {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={6}
        style={style}>
        <GlassView style={styles.glass} glassEffectStyle="regular" isInteractive>
          {icon}
        </GlassView>
      </Pressable>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={[styles.androidShadow, style]}>
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          android_ripple={{
            color: 'rgba(0,0,0,0.14)',
            borderless: true,
            radius: 22,
          }}
          style={({ pressed }) => [
            styles.android,
            {
              backgroundColor: theme.backgroundElement,
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          {icon}
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [
        styles.fallback,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {icon}
    </Pressable>
  );
}

const SIZE = 40;

const styles = StyleSheet.create({
  glass: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  androidShadow: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    elevation: 2,
    backgroundColor: 'transparent',
  },
  android: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
