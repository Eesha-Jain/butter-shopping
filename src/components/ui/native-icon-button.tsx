import * as Haptics from 'expo-haptics';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  accessibilityLabel: string;
  onPress: () => void;
  /** SF Symbol name (iOS). */
  iosSymbol: string;
  /** Material symbol name (Android / web). */
  androidSymbol: string;
  style?: StyleProp<ViewStyle>;
  /** Label shown on long press. Defaults to accessibilityLabel. */
  tooltip?: string;
  /** Which edge of the button the long-press label lines up with, so it stays on screen. */
  tooltipAlign?: 'left' | 'center' | 'right';
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
  tooltip,
  tooltipAlign = 'center',
}: Props) {
  const theme = useTheme();
  const glass = useGlassOnIos();
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  // A long press shows the label instead of firing onPress.
  const pressHandlers = {
    onPress: handlePress,
    onLongPress: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setTooltipVisible(true);
    },
    onPressOut: () => setTooltipVisible(false),
    delayLongPress: 350,
  };

  const withTooltip = (button: React.ReactNode) => (
    <View style={styles.anchor}>
      {button}
      {tooltipVisible ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(120)}
          pointerEvents="none"
          style={[
            styles.tooltipTrack,
            tooltipAlign === 'left'
              ? styles.trackLeft
              : tooltipAlign === 'right'
                ? styles.trackRight
                : styles.trackCenter,
          ]}>
          <View style={[styles.tooltip, { backgroundColor: theme.text }]}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={[styles.tooltipText, { color: theme.background }]}>
              {tooltip ?? accessibilityLabel}
            </ThemedText>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );

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
    return withTooltip(
      <Pressable
        {...pressHandlers}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={6}
        style={style}>
        <GlassView style={styles.glass} glassEffectStyle="regular" isInteractive>
          {icon}
        </GlassView>
      </Pressable>,
    );
  }

  if (Platform.OS === 'android') {
    return withTooltip(
      <View style={[styles.androidShadow, style]}>
        <Pressable
          {...pressHandlers}
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
      </View>,
    );
  }

  return withTooltip(
    <Pressable
      {...pressHandlers}
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
    </Pressable>,
  );
}

const SIZE = 40;
const TOOLTIP_TRACK = 200;

const styles = StyleSheet.create({
  anchor: {
    position: 'relative',
    zIndex: 10,
  },
  tooltipTrack: {
    position: 'absolute',
    top: SIZE + 6,
    width: TOOLTIP_TRACK,
    zIndex: 10,
    elevation: 6,
  },
  trackLeft: {
    left: 0,
    alignItems: 'flex-start',
  },
  trackRight: {
    right: 0,
    alignItems: 'flex-end',
  },
  trackCenter: {
    left: (SIZE - TOOLTIP_TRACK) / 2,
    alignItems: 'center',
  },
  tooltip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  tooltipText: {
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 16,
  },
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
