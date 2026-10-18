import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';

type Size = 'sm' | 'md';

type Props = {
  size?: Size;
  style?: StyleProp<ViewStyle>;
};

/**
 * Compact SNAP indicator (not the official USDA mark).
 * Shown next to stores that accept EBT and foods that are SNAP-eligible.
 */
export function SnapBadge({ size = 'sm', style }: Props) {
  const compact = size === 'sm';
  return (
    <View
      style={[styles.badge, compact ? styles.sm : styles.md, style]}
      accessibilityRole="text"
      accessibilityLabel="SNAP">
      <Text style={[styles.label, compact ? styles.labelSm : styles.labelMd]}>SNAP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#0B3D91',
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  sm: {
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  label: {
    color: '#FFFFFF',
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.4,
  },
  labelSm: {
    fontSize: 10,
    lineHeight: 12,
  },
  labelMd: {
    fontSize: 12,
    lineHeight: 14,
  },
});
