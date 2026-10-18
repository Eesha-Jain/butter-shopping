import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'ink' | 'yellow' | 'ghost';

type Props = Omit<PressableProps, 'style'> & {
  label: string;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
};

/**
 * Primary CTA language shared with onboarding Continue — ink or yellow fill, light haptic.
 */
export function ButterButton({
  label,
  variant = 'ink',
  onPress,
  disabled,
  style,
  ...rest
}: Props) {
  const theme = useTheme();

  const handlePress: PressableProps['onPress'] = (event) => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(event);
  };

  const bg =
    variant === 'ink'
      ? theme.secondary
      : variant === 'yellow'
        ? theme.primary
        : 'transparent';
  const labelColor =
    variant === 'ink' ? theme.primary : theme.text;
  const borderColor = variant === 'ghost' ? theme.borderInk : 'transparent';

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'ghost' ? 2 : 0,
          opacity: disabled ? 0.55 : pressed ? 0.88 : 1,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.button,
    minHeight: 52,
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: 17,
  },
});
