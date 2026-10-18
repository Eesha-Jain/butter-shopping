import { getItem, removeItem, setItem } from './storage';

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
