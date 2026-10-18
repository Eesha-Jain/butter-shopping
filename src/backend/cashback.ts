import {
  getLocalGroceryCashbackBps,
  hasCompletedOnboardingLocally,
  markOnboardingCompletedLocally,
  setLocalGroceryCashbackBps,
} from './preferences';
import { getMyProfile, updateMyProfile } from './supabase/profiles';

/**
 * Effective grocery cashback bps for the current shopper.
 * Signed-in users read profiles; guests use local storage.
 */
export async function getEffectiveGroceryCashbackBps(isGuest: boolean): Promise<number | null> {
  if (isGuest) return getLocalGroceryCashbackBps();
  try {
    const profile = await getMyProfile();
    return profile.grocery_cashback_bps;
  } catch {
    return getLocalGroceryCashbackBps();
  }
}

export async function setGroceryCashbackBps(bps: number | null, isGuest: boolean): Promise<void> {
  setLocalGroceryCashbackBps(bps);
  if (isGuest) return;
  await updateMyProfile({ grocery_cashback_bps: bps });
}

export async function needsOnboarding(isGuest: boolean): Promise<boolean> {
  if (isGuest) return !hasCompletedOnboardingLocally();
  try {
    const profile = await getMyProfile();
    return profile.onboarding_completed_at == null;
  } catch {
    return !hasCompletedOnboardingLocally();
  }
}

export async function completeOnboarding(isGuest: boolean): Promise<void> {
  markOnboardingCompletedLocally();
  if (isGuest) return;
  await updateMyProfile({ onboarding_completed_at: new Date().toISOString() });
}

/** After sign-in, copy guest cashback onto the profile when the profile has none. */
export async function mergeGuestCashbackIntoProfile(): Promise<void> {
  const local = getLocalGroceryCashbackBps();
  if (local == null) return;
  try {
    const profile = await getMyProfile();
    if (profile.grocery_cashback_bps != null) return;
    await updateMyProfile({ grocery_cashback_bps: local });
  } catch {
    // Non-blocking.
  }
}
