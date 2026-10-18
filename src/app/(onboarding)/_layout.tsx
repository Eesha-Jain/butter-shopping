import { Stack } from 'expo-router';

import { OnboardingDraftProvider } from '@/auth/onboarding-draft';

export default function OnboardingLayout() {
  return (
    <OnboardingDraftProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'slide_from_right',
        }}
      />
    </OnboardingDraftProvider>
  );
}
