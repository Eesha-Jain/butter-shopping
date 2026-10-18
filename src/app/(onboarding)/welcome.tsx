import { router, type Href } from 'expo-router';

import { goToOnboardingAccount } from '@/auth/finish-onboarding';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';

export default function OnboardingWelcomeScreen() {
  return (
    <OnboardingShell
      step={1}
      hero
      title="Welcome to Butter Shopping"
      subtitle="No BS. One-stop shop for chops."
      continueLabel="Get started →"
      onSkip={goToOnboardingAccount}
      onContinue={() => router.push('/(onboarding)/eat' as Href)}
    />
  );
}
