import { useCallback } from 'react';

import { completeOnboardingWithDraft, persistOnboardingDraft } from '@/auth/finish-onboarding';
import { useOnboardingDraft } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import { hasSignedInBefore } from '@/backend';
import { AuthForm } from '@/components/auth/auth-form';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';

export default function OnboardingAccountScreen() {
  const { finishOnboarding, continueAsGuest } = useSession();
  const draft = useOnboardingDraft();
  const initialMode = hasSignedInBefore() ? 'logIn' : 'signUp';

  const finishAsGuest = useCallback(async () => {
    // Persist first so the guest gate refresh sees onboarding as done.
    try {
      await persistOnboardingDraft({ isGuest: true, ...draft.toPayload() });
    } catch {
      // Still enter as guest.
    }
    continueAsGuest();
    finishOnboarding();
  }, [continueAsGuest, draft, finishOnboarding]);

  const finishAsSignedIn = useCallback(async () => {
    await completeOnboardingWithDraft({
      isGuest: false,
      finishOnboarding,
      draft: draft.toPayload(),
    });
  }, [draft, finishOnboarding]);

  return (
    <OnboardingShell
      step={5}
      title="Save your Butter prefs"
      subtitle="Create an account, log in, or keep browsing as a guest."
      hideContinue
      skipLabel="Continue as guest"
      onSkip={() => void finishAsGuest()}
      onContinue={() => {}}>
      <AuthForm
        embedded
        initialMode={initialMode}
        onAuthSuccess={finishAsSignedIn}
        onGuestContinue={finishAsGuest}
      />
    </OnboardingShell>
  );
}
