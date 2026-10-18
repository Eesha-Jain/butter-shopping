import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  step: 1 | 2 | 3;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onSkip: () => void;
  onContinue: () => void;
  continueLabel?: string;
};

export function OnboardingShell({
  step,
  title,
  subtitle,
  children,
  onSkip,
  onContinue,
  continueLabel = 'Continue',
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + Spacing.four,
          paddingBottom: insets.bottom + Spacing.four,
        },
      ]}>
      <ThemedText type="small" themeColor="textSecondary">
        Step {step} of 3
      </ThemedText>
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
        {subtitle}
      </ThemedText>
      <View style={styles.body}>{children}</View>
      <View style={styles.footer}>
        <Pressable onPress={onSkip} hitSlop={8} style={styles.skipBtn}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Skip
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={onContinue}
          style={[styles.continueBtn, { backgroundColor: theme.primary }]}>
          <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
            {continueLabel}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: selected ? theme.primaryDark : theme.border,
        },
      ]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    marginTop: Spacing.one,
  },
  subtitle: {
    marginBottom: Spacing.two,
  },
  body: {
    flex: 1,
    gap: Spacing.three,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  skipBtn: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  continueBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
});
