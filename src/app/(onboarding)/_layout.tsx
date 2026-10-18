import { Stack } from 'expo-router';

import { OnboardingDraftProvider } from '@/auth/onboarding-draft';
import { ONBOARDING_YELLOW } from '@/components/onboarding/onboarding-shell';

export default function OnboardingLayout() {
  return (
    <OnboardingDraftProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: ONBOARDING_YELLOW },
          animation: 'slide_from_right',
          // When a past step is reached via replace, animate like a back gesture.
          animationTypeForReplace: 'pop',
        }}>
        {/* First paint / welcome: soft fade, not a horizontal slide "from somewhere". */}
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="account" />
        <Stack.Screen name="eat" />
        <Stack.Screen name="save" />
        <Stack.Screen name="shop" />
      </Stack>
    </OnboardingDraftProvider>
  );
}
