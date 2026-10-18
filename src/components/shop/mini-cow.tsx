import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';

const ORBIT_RADIUS = 1.5;
const TILT_DEG = 8;
const LOOP_MS = 2200;

type Props = { size?: number; flipped?: boolean };

/** Tiny inline version of the onboarding cow: same orbit + lean, no "moo". */
export function MiniCow({ size = 22, flipped = false }: Props) {
  const time = useSharedValue(0);
  useFrameCallback((frame) => {
    time.value = frame.timestamp;
  });

  const style = useAnimatedStyle(() => {
    const angle = ((time.value / LOOP_MS) % 1) * Math.PI * 2;
    return {
      transform: [
        { translateX: Math.sin(angle) * ORBIT_RADIUS },
        { translateY: -Math.cos(angle) * ORBIT_RADIUS },
        { rotate: `${Math.sin(angle) * TILT_DEG}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Image
        source={require('@/assets/images/logo.png')}
        style={[styles.fill, flipped && styles.flipped]}
        contentFit="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  flipped: { transform: [{ scaleX: -1 }] },
});
