import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius } from '@/constants/theme';

type Props = {
  size?: number;
  /** Base butter fill (defaults to theme accentSoft via caller). */
  color: string;
  /** Slightly lighter highlight for the shine (optional). */
  highlightColor?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

function lightenHex(hex: string, amount = 0.28): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const n = Number.parseInt(raw, 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amount));
  const g = Math.min(255, Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amount));
  const b = Math.min(255, Math.round((n & 255) + (255 - (n & 255)) * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function deepenHex(hex: string, amount = 0.12): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const n = Number.parseInt(raw, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Soft rectangular butter stick — faux 3D shine for product pods.
 * Sit a square ProductPhoto inside as children.
 */
export function ButterBlock({
  size = 140,
  color,
  highlightColor,
  children,
  style,
}: Props) {
  const highlight = highlightColor ?? lightenHex(color, 0.35);
  const rich = deepenHex(color, 0.1);
  const radius = Math.min(Radius.card, size * 0.14);

  return (
    <View
      style={[
        styles.outer,
        {
          width: size,
          height: size,
          borderRadius: radius,
          ...Platform.select({
            ios: {
              shadowColor: '#8A7000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.18,
              shadowRadius: 8,
            },
            android: { elevation: 3 },
            default: {},
          }),
        },
        style,
      ]}>
      <LinearGradient
        colors={[highlight, color, rich]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.face, { borderRadius: radius }]}>
        <LinearGradient
          colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.65, y: 0.55 }}
          style={[styles.sheen, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]}
          pointerEvents="none"
        />
        <View style={styles.content}>{children}</View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    overflow: 'visible',
  },
  face: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheen: {
    ...StyleSheet.absoluteFill,
    height: '42%',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
