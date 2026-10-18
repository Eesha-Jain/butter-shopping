import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutLeft } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingCow } from '@/components/onboarding/onboarding-cow';
import { Fonts, Spacing } from '@/constants/theme';

export const ONBOARDING_YELLOW = '#ffd700';
const INK = '#000000';
const BUBBLE = '#ffffff';

type Props = {
  step: 1 | 2 | 3;
  title: string;
  subtitle?: string;
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
  const insets = useSafeAreaInsets();

  const handleContinue = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onContinue();
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: ONBOARDING_YELLOW,
          paddingTop: insets.top + Spacing.three,
          paddingBottom: insets.bottom + Spacing.three,
        },
      ]}>
      <OnboardingCow />

      <Animated.View
        key={`bubble-${step}`}
        entering={FadeInDown.duration(320)}
        exiting={FadeOutLeft.duration(180)}
        style={styles.bubbleBlock}>
        <View style={styles.tail} />
        <View style={styles.bubble}>
          <Text style={styles.bubbleTitle}>{title}</Text>
          {subtitle ? <Text style={styles.bubbleSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.dots}>
          {([1, 2, 3] as const).map((n) => (
            <View
              key={n}
              style={[styles.dot, n === step ? styles.dotActive : styles.dotIdle]}
            />
          ))}
        </View>
      </Animated.View>

      <Animated.View
        key={`body-${step}`}
        entering={FadeInDown.delay(80).duration(360)}
        exiting={FadeOutLeft.duration(180)}
        style={styles.body}>
        {children}
      </Animated.View>

      <View style={styles.footer}>
        <Pressable
          onPress={handleContinue}
          style={styles.continueBtn}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}>
          <Text style={styles.continueLabel}>{continueLabel}</Text>
        </Pressable>
        <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button">
          <Text style={styles.skipLabel}>Skip</Text>
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
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipSelected : styles.chipIdle]}
      accessibilityRole="button"
      accessibilityState={{ selected }}>
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

/** Small section label on the yellow canvas (Avoid / Prefer / etc.). */
export function OnboardingLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  bubbleBlock: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: BUBBLE,
    marginBottom: -2,
  },
  bubble: {
    backgroundColor: BUBBLE,
    borderRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    width: '100%',
    gap: Spacing.one,
    borderWidth: 3,
    borderColor: INK,
  },
  bubbleTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 22,
    lineHeight: 28,
    color: INK,
    textAlign: 'center',
  },
  bubbleSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: '#333333',
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotActive: {
    backgroundColor: INK,
    width: 22,
  },
  dotIdle: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  body: {
    flex: 1,
    gap: Spacing.two,
    minHeight: 0,
  },
  footer: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  continueBtn: {
    width: '100%',
    backgroundColor: INK,
    alignItems: 'center',
    paddingVertical: Spacing.three + 2,
    borderRadius: 16,
  },
  continueLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 18,
    color: ONBOARDING_YELLOW,
  },
  skipLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: INK,
    textDecorationLine: 'underline',
    paddingVertical: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: INK,
  },
  chipIdle: {
    backgroundColor: BUBBLE,
  },
  chipSelected: {
    backgroundColor: INK,
  },
  chipText: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: INK,
  },
  chipTextSelected: {
    color: ONBOARDING_YELLOW,
  },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: INK,
    marginTop: Spacing.one,
  },
});
