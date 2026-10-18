import { router, type Href } from 'expo-router';

import type { SessionFoodRule } from '@/backend';
import {
  completeOnboarding,
  resolveCollegeId,
  setDiscountEligibility,
  setGroceryCashbackBps,
  setMyFoodRules,
  updateMyProfile,
} from '@/backend';

import type { OnboardingDraftPayload, TransportMode } from './onboarding-draft';

const ACCOUNT_HREF = '/(onboarding)/account' as Href;

/** Persist whatever the draft holds, then mark onboarding complete. */
export async function persistOnboardingDraft(
  input: OnboardingDraftPayload & { isGuest: boolean },
): Promise<void> {
  const {
    isGuest,
    foodRules,
    discountCodes,
    cashbackBps,
    collegeId,
    collegeName,
    transportModes,
    maxStores,
  } = input;

  if (isGuest) {
    await setGroceryCashbackBps(cashbackBps, true);
    await completeOnboarding(true);
    return;
  }

  if (foodRules.length > 0) {
    await setMyFoodRules(
      foodRules.map((rule: SessionFoodRule) => ({
        traitId: rule.trait_id,
        mode: rule.mode,
      })),
    );
  }

  for (const code of discountCodes) {
    await setDiscountEligibility(code, true);
  }

  let resolvedCollegeId: string | null = null;
  if (discountCodes.includes('student')) {
    resolvedCollegeId = await resolveCollegeId({ collegeId, collegeName });
  }

  const primaryMode: TransportMode | null = transportModes[0] ?? null;

  await updateMyProfile({
    college_id: resolvedCollegeId,
    transport_mode: primaryMode,
    transport_modes: transportModes.length > 0 ? transportModes : null,
    max_stores_per_trip: maxStores,
    grocery_cashback_bps: cashbackBps,
    onboarding_completed_at: new Date().toISOString(),
  });
}

/** Jump to the account step (last onboarding screen) without finishing the flow. */
export function goToOnboardingAccount(): void {
  router.push(ACCOUNT_HREF);
}

/**
 * Finish onboarding after account step: persist prefs, then close the gate.
 * Call after sign-in or continue-as-guest.
 */
export async function completeOnboardingWithDraft(input: {
  isGuest: boolean;
  finishOnboarding: () => void;
  draft: OnboardingDraftPayload;
}): Promise<void> {
  try {
    await persistOnboardingDraft({
      isGuest: input.isGuest,
      ...input.draft,
    });
  } catch {
    try {
      await completeOnboarding(input.isGuest);
    } catch {
      // Gate still closes below.
    }
  }
  input.finishOnboarding();
}
