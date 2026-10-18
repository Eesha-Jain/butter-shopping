import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutLeft,
  ZoomIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingCow } from '@/components/onboarding/onboarding-cow';
import { BUTTER_YELLOW, Fonts, Spacing } from '@/constants/theme';

/** @deprecated Prefer BUTTER_YELLOW from theme — kept for onboarding imports. */
export const ONBOARDING_YELLOW = BUTTER_YELLOW;
const INK = '#000000';
const BUBBLE = '#ffffff';
const COMPACT_MS = 280;

const STEP_HREF: Record<1 | 2 | 3 | 4 | 5, Href> = {
  1: '/(onboarding)/welcome',
  2: '/(onboarding)/account',
  3: '/(onboarding)/eat',
  4: '/(onboarding)/save',
  5: '/(onboarding)/shop',
};

type Props = {
  step: 1 | 2 | 3 | 4 | 5;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  onSkip?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  skipLabel?: string;
  /** Hide the speech bubble and show title as a hero (welcome screen). */
  hero?: boolean;
  /** Keep the cow but omit the speech bubble (e.g. account / auth step). */
  hideBubble?: boolean;
  /** Hide the primary Continue button (e.g. account screen uses AuthForm CTAs). */
  hideContinue?: boolean;
  /** Hide the step dots (welcome + auth). */
  hideDots?: boolean;
  /** Hide the top-right skip / continue-as-guest control. */
  hideSkip?: boolean;
};

export function OnboardingShell({
  step,
  title,
  subtitle,
  children,
  onSkip,
  onContinue,
  continueLabel = 'Continue',
  skipLabel = 'Skip all',
  hero = false,
  hideBubble = false,
  hideContinue = false,
  hideDots = false,
  hideSkip = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const compactProgress = useSharedValue(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      compactProgress.value = withTiming(1, { duration: COMPACT_MS });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      compactProgress.value = withTiming(0, { duration: COMPACT_MS });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [compactProgress]);

  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(compactProgress.value, [0, 0.55], [1, 0]),
    maxHeight: interpolate(compactProgress.value, [0, 1], [200, 0]),
    marginBottom: interpolate(compactProgress.value, [0, 1], [0, -Spacing.two]),
    transform: [{ scale: interpolate(compactProgress.value, [0, 1], [1, 0.92]) }],
    overflow: 'hidden' as const,
  }));

  const heroTextStyle = useAnimatedStyle(() => ({
    opacity: interpolate(compactProgress.value, [0, 0.55], [1, 0]),
    maxHeight: interpolate(compactProgress.value, [0, 1], [120, 0]),
    overflow: 'hidden' as const,
  }));

  const handleContinue = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onContinue();
  };

  const handleSkip = () => {
    if (!onSkip) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSkip();
  };

  const goToStep = (n: 1 | 2 | 3 | 4 | 5) => {
    if (n >= step) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Pop to that route when it's in history; otherwise replace (e.g. after Skip).
    // Do not loop router.back() — canGoBack() is stale until the queue runs.
    router.dismissTo(STEP_HREF[n]);
  };

  const showTopBar = !hideDots || !hideSkip;

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
      {showTopBar ? (
        <View style={styles.topBar}>
          {hideDots ? (
            <View />
          ) : (
            <View style={styles.dots}>
              {([1, 2, 3, 4, 5] as const).map((n) => {
                const isCurrent = n === step;
                const isPast = n < step;
                return (
                  <Pressable
                    key={n}
                    onPress={() => goToStep(n)}
                    disabled={!isPast}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Onboarding step ${n}`}
                    accessibilityState={{ selected: isCurrent, disabled: !isPast }}>
                    <View
                      style={[
                        styles.dot,
                        isCurrent ? styles.dotActive : isPast ? styles.dotPast : styles.dotIdle,
                      ]}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
          {hideSkip ? null : (
            <Pressable onPress={handleSkip} hitSlop={12} accessibilityRole="button">
              <Text style={styles.skipTop}>{skipLabel}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {hero ? (
        <View style={styles.heroCenter}>
          <Animated.View entering={ZoomIn.duration(560).springify().damping(15).stiffness(120)}>
            <OnboardingCow compactProgress={compactProgress} />
          </Animated.View>
          {title ? (
            <Animated.View
              key={`hero-${step}`}
              entering={FadeInDown.delay(180).duration(420)}
              style={[styles.heroBlock, heroTextStyle]}>
              <Text style={styles.heroTitle}>{title}</Text>
              {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
            </Animated.View>
          ) : null}
        </View>
      ) : (
        <>
          <OnboardingCow compactProgress={compactProgress} />
          {!hideBubble && title ? (
            <Animated.View
              key={`bubble-${step}`}
              entering={FadeInDown.duration(320)}
              exiting={FadeOutLeft.duration(180)}
              style={[styles.bubbleBlock, bubbleStyle]}>
              <View style={styles.tail} />
              <View style={styles.bubble}>
                <Text style={styles.bubbleTitle}>{title}</Text>
                {subtitle ? <Text style={styles.bubbleSubtitle}>{subtitle}</Text> : null}
              </View>
            </Animated.View>
          ) : null}
          {children ? (
            <Animated.View
              key={`body-${step}`}
              entering={FadeInDown.delay(80).duration(360)}
              exiting={FadeOutLeft.duration(180)}
              style={styles.body}>
              {children}
            </Animated.View>
          ) : (
            <View style={styles.body} />
          )}
        </>
      )}

      {hideContinue ? null : (
        <Animated.View
          entering={hero ? FadeIn.delay(380).duration(420) : undefined}
          style={styles.footer}>
          <Pressable
            onPress={handleContinue}
            style={styles.continueBtn}
            accessibilityRole="button"
            accessibilityLabel={continueLabel}>
            <Text style={styles.continueLabel}>{continueLabel}</Text>
          </Pressable>
        </Animated.View>
      )}
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotActive: {
    backgroundColor: INK,
    width: 26,
  },
  /** Already visited — tappable to go back. */
  dotPast: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  /** Not reached yet — not tappable. */
  dotIdle: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  skipTop: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: INK,
    textDecorationLine: 'underline',
  },
  bubbleBlock: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  heroCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
  heroBlock: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
  },
  heroTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 34,
    lineHeight: 40,
    color: INK,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: 17,
    lineHeight: 24,
    color: '#222222',
    textAlign: 'center',
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
