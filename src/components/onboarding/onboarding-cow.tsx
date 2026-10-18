import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const HOP_UP = -14;
const HOP_MS = 380;

/**
 * Butter cow logo with a continuous excited hop.
 * Remounts with each onboarding step, so mount-scoped animation is enough.
 */
export function OnboardingCow() {
  const [hop] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hop, {
          toValue: 1,
          duration: HOP_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(hop, {
          toValue: 0,
          duration: HOP_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hop]);

  const translateY = hop.interpolate({
    inputRange: [0, 1],
    outputRange: [0, HOP_UP],
  });
  const scale = hop.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ translateY }, { scale }] }}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
  },
  logo: {
    width: 148,
    height: 148,
  },
});
