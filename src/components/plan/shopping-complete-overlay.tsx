import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingCow } from '@/components/onboarding/onboarding-cow';
import { BUTTER_YELLOW, Fonts, Spacing } from '@/constants/theme';

const INK = '#000000';
const EXPAND_MS = 520;

export type CelebrationOrigin = { x: number; y: number };

type Props = {
  /** Screen point the yellow expands from; null hides the overlay. */
  origin: CelebrationOrigin | null;
  onContinue: () => void;
};

/** Yellow circle grows out of the checkbox to fill the screen, then the cow + message appear. */
export function ShoppingCompleteOverlay({ origin, onContinue }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!origin) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: EXPAND_MS, easing: Easing.out(Easing.cubic) });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }, [origin, progress]);

  const radius = origin
    ? Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y))
    : 0;

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  const handleContinue = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onContinue();
  };

  return (
    <Modal
      visible={origin != null}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleContinue}>
      {origin ? (
        <View style={styles.root}>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: origin.x - radius,
                top: origin.y - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: radius,
                backgroundColor: BUTTER_YELLOW,
              },
              circleStyle,
            ]}
          />
          <View
            style={[
              styles.content,
              { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.three },
            ]}>
            <View style={styles.center}>
              <Animated.View entering={FadeIn.delay(EXPAND_MS - 120).duration(300)}>
                <OnboardingCow />
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(EXPAND_MS).duration(420)}>
                <Text style={styles.title}>Congratulations on finishing shopping!</Text>
              </Animated.View>
            </View>
            <Animated.View entering={FadeIn.delay(EXPAND_MS + 200).duration(350)}>
              <Pressable
                onPress={handleContinue}
                style={styles.button}
                accessibilityRole="button"
                accessibilityLabel="Continue">
                <Text style={styles.buttonLabel}>Continue</Text>
              </Pressable>
            </Animated.View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 34,
    lineHeight: 40,
    color: INK,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    backgroundColor: INK,
    alignItems: 'center',
    paddingVertical: Spacing.three + 2,
    borderRadius: 16,
  },
  buttonLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 18,
    color: BUTTER_YELLOW,
  },
});
