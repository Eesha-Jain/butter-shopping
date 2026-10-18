import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { useSession } from '@/auth/session';
import { markWelcomeSeen } from '@/backend';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';

export default function OnboardingWelcomeScreen() {
  const { session, isGuest } = useSession();

  useEffect(() => {
    if (session || isGuest) {
      router.replace('/(onboarding)/eat' as Href);
    }
  }, [isGuest, session]);

  return (
    <OnboardingShell
      step={1}
      hero
      hideDots
      hideSkip
      title="Welcome to Butter Shopping"
      subtitle="No BS. One-stop shop for chops."
      continueLabel="Get started →"
      onContinue={() => {
        markWelcomeSeen();
        router.push('/(onboarding)/account' as Href);
      }}
    />
  );
}
