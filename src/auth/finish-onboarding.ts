import type { SessionFoodRule } from '@/backend';
import {
  completeOnboarding,
  setDiscountEligibility,
  setGroceryCashbackBps,
  setMyFoodRules,
  updateMyProfile,
} from '@/backend';

import type { TransportMode } from './onboarding-draft';

/** Persist whatever the draft holds, then mark onboarding complete. */
export async function persistOnboardingDraft(input: {
  isGuest: boolean;
  foodRules: SessionFoodRule[];
  discountCodes: string[];
  cashbackBps: number | null;
  transportMode: TransportMode | null;
  maxStores: number | null;
}): Promise<void> {
  const { isGuest, foodRules, discountCodes, cashbackBps, transportMode, maxStores } = input;

  if (isGuest) {
    await setGroceryCashbackBps(cashbackBps, true);
    await completeOnboarding(true);
    return;
  }

  if (foodRules.length > 0) {
    await setMyFoodRules(
      foodRules.map((rule) => ({
        traitId: rule.trait_id,
        mode: rule.mode,
      })),
    );
  }
  for (const code of discountCodes) {
    await setDiscountEligibility(code, true);
  }
  await updateMyProfile({
    transport_mode: transportMode,
    max_stores_per_trip: maxStores,
    grocery_cashback_bps: cashbackBps,
    onboarding_completed_at: new Date().toISOString(),
  });
}
