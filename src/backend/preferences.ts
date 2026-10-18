import { getItem, removeItem, setItem, type StorageKey } from './storage';

const ALL_STORAGE_KEYS: StorageKey[] = [
  'hasSignedIn',
  'isGuest',
  'guestCart',
  'guestFavorites',
  'guestOnboarding',
  'onboardingCompleted',
  'hasSeenWelcome',
  'groceryCashbackBps',
];

/**
 * Wipe on-device prefs (guest cart, onboarding flag, etc.).
 * TEMP: for local testing — pair with sign-out + app reload.
 */
export function clearLocalData(): void {
  for (const key of ALL_STORAGE_KEYS) {
    removeItem(key);
  }
}

/**
 * Whether this device has completed a sign-in or sign-up before.
 * Survives sign-out so the auth screen can default to Log in.
 */
export function hasSignedInBefore(): boolean {
  return getItem('hasSignedIn') === '1';
}

export function markHasSignedIn(): void {
  setItem('hasSignedIn', '1');
}

/** Device is browsing without a Supabase session. */
export function isGuest(): boolean {
  return getItem('isGuest') === '1';
}

export function markIsGuest(): void {
  setItem('isGuest', '1');
}

export function clearGuest(): void {
  removeItem('isGuest');
}

/** Local flag when guest finished or skipped onboarding. */
export function hasCompletedOnboardingLocally(): boolean {
  return getItem('onboardingCompleted') === '1';
}

export function markOnboardingCompletedLocally(): void {
  setItem('onboardingCompleted', '1');
}

/** Whether this install has already shown the welcome screen. */
export function hasSeenWelcome(): boolean {
  return getItem('hasSeenWelcome') === '1';
}

export function markWelcomeSeen(): void {
  setItem('hasSeenWelcome', '1');
}

/** Guest (or device) grocery cashback in basis points. */
export function getLocalGroceryCashbackBps(): number | null {
  const raw = getItem('groceryCashbackBps');
  if (raw == null || raw === '') return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || value > 1000) return null;
  return value;
}

export function setLocalGroceryCashbackBps(bps: number | null): void {
  if (bps == null) {
    removeItem('groceryCashbackBps');
    return;
  }
  setItem('groceryCashbackBps', String(bps));
}
