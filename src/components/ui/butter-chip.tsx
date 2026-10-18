import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Optional leading icon (tinted by selected state via parent). */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Soft nav chip — selected = gold wash + ink label (ink reserved for primary CTAs). */
export function ButterChip({ label, selected = false, onPress, icon, style }: Props) {
  const theme = useTheme();
  const labelColor = selected ? theme.text : theme.textSecondary;

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[
        styles.chip,
        icon ? styles.chipWithIcon : null,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.background,
          borderColor: selected ? theme.border : theme.border,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}>
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: 1,
  },
  chipWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
  },
});
