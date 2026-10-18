/**
 * Native on-device storage for app preferences (expo-sqlite localStorage).
 */
import 'expo-sqlite/localStorage/install';

const KEYS = {
  hasSignedIn: 'butter.hasSignedIn',
  isGuest: 'butter.isGuest',
  guestCart: 'butter.guestCart',
  guestFavorites: 'butter.guestFavorites',
  guestOnboarding: 'butter.guestOnboarding',
  onboardingCompleted: 'butter.onboardingCompleted',
  hasSeenWelcome: 'butter.hasSeenWelcome',
  groceryCashbackBps: 'butter.groceryCashbackBps',
  /** '1' / unset = play spoken replies for typed AI input; '0' = silent text replies. */
  aiTextReplyAudio: 'butter.aiTextReplyAudio',
  /** 'female' | 'male' | 'cow'. Cow moos; the reply text still shows the words. */
  aiVoice: 'butter.aiVoice',
  /** Text of the last three voice requests, newest first. Not the audio. */
  recentVoiceTexts: 'butter.recentVoiceTexts',
  activeListId: 'butter.activeListId',
  /** Last successful Shop home payload, shown instantly on next launch. */
  shopHomeCache: 'butter.shopHomeCache',
  /** Cheapest-price cache for the Shop (small; rewritten as prices arrive). */
  shopPriceCache: 'butter.shopPriceCache',
} as const;

export type StorageKey = keyof typeof KEYS;

function resolveKey(key: StorageKey): string {
  return KEYS[key];
}

export function getItem(key: StorageKey): string | null {
  try {
    return localStorage.getItem(resolveKey(key));
  } catch {
    return null;
  }
}

export function setItem(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(resolveKey(key), value);
  } catch {
    // Storage may be unavailable.
  }
}

export function removeItem(key: StorageKey): void {
  try {
    localStorage.removeItem(resolveKey(key));
  } catch {
    // Ignore storage failures.
  }
}

export function getJson<T>(key: StorageKey): T | null {
  const raw = getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(key: StorageKey, value: unknown): void {
  setItem(key, JSON.stringify(value));
}

export function getAuthStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return localStorage;
}
