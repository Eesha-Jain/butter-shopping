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
        }}
      />
    </OnboardingDraftProvider>
  );
}
