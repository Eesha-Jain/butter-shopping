import { router, type Href } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { goToOnboardingPrefs } from '@/auth/finish-onboarding';
import { useSession } from '@/auth/session';
import { hasSignedInBefore, needsOnboarding } from '@/backend';
import { AuthForm } from '@/components/auth/auth-form';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';

export default function OnboardingAccountScreen() {
  const { session, finishOnboarding, continueAsGuest } = useSession();
  const initialMode = hasSignedInBefore() ? 'logIn' : 'signUp';

  // After sign-up / log-in, continue to prefs — or into the app if already done.
  // Guests are routed explicitly so they can still come back here to create an account.
  useEffect(() => {
    if (!session) return;
    let active = true;
    void needsOnboarding(false)
      .then((needed) => {
        if (!active) return;
        if (needed) {
          router.replace('/(onboarding)/eat' as Href);
          return;
        }
        finishOnboarding();
      })
      .catch(() => {
        if (active) router.replace('/(onboarding)/eat' as Href);
      });
    return () => {
      active = false;
    };
  }, [finishOnboarding, session]);

  const continueAsGuestIntoPrefs = useCallback(() => {
    continueAsGuest();
    goToOnboardingPrefs();
  }, [continueAsGuest]);

  return (
    <OnboardingShell
      step={2}
      hideBubble
      hideContinue
      hideDots
      skipLabel="Continue as guest"
      onSkip={continueAsGuestIntoPrefs}
      onContinue={() => {}}>
      <AuthForm embedded initialMode={initialMode} />
    </OnboardingShell>
  );
}
