import { Image } from 'expo-image';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  interpolate,
  makeMutable,
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
} from 'react-native-reanimated';

import { Fonts } from '@/constants/theme';

const ORBIT_RADIUS = 10;
const TILT_DEG = 14;
const LOOP_MS = 2200;
const COW_SIZE = 148;
const WRAP_H = 160;
const COMPACT_WRAP_H = 64;
const COMPACT_SCALE = 0.42;

/** Survives screen remounts so the orbit phase stays continuous across onboarding. */
const orbitTime = makeMutable(0);

type Props = {
  /** 0 = full size, 1 = keyboard-compact. */
  compactProgress?: SharedValue<number>;
};

/**
 * Butter cow logo that orbits in a small circle with a playful lean.
 * Orbit phase is module-scoped so Stack transitions don't reset/flash it.
 */
export function OnboardingCow({ compactProgress }: Props) {
  useFrameCallback((frame) => {
    orbitTime.value = frame.timestamp;
  });

  const wrapStyle = useAnimatedStyle(() => {
    const p = compactProgress?.value ?? 0;
    return {
      height: interpolate(p, [0, 1], [WRAP_H, COMPACT_WRAP_H]),
    };
  });

  const animatedStyle = useAnimatedStyle(() => {
    const p = compactProgress?.value ?? 0;
    const angle = ((orbitTime.value / LOOP_MS) % 1) * Math.PI * 2;
    const radius = interpolate(p, [0, 1], [ORBIT_RADIUS, 4]);
    const tilt = interpolate(p, [0, 1], [TILT_DEG, 6]);
    const sizeScale = interpolate(p, [0, 1], [1, COMPACT_SCALE]);
    return {
      transform: [
        { translateX: Math.sin(angle) * radius },
        { translateY: -Math.cos(angle) * radius },
        { rotate: `${Math.sin(angle) * tilt}deg` },
        { scale: sizeScale },
      ],
    };
  });

  const mooStyle = useAnimatedStyle(() => {
    const p = compactProgress?.value ?? 0;
    return {
      opacity: interpolate(p, [0, 0.4], [1, 0]),
    };
  });

  return (
    <Animated.View style={[styles.wrap, wrapStyle]}>
      <Animated.View style={[styles.cow, animatedStyle]}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Animated.Text style={[styles.moo, mooStyle]}>moooo</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cow: {
    width: COW_SIZE,
    height: COW_SIZE,
  },
  logo: {
    width: COW_SIZE,
    height: COW_SIZE,
  },
  moo: {
    position: 'absolute',
    top: 8,
    right: 22,
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    color: '#000000',
    transform: [{ rotate: '12deg' }],
  },
});
