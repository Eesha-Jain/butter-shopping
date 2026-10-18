/**
 * Default / web on-device storage for app preferences (browser localStorage).
 * Native overrides this via storage.native.ts (expo-sqlite localStorage).
 */

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
} as const;

export type StorageKey = keyof typeof KEYS;

const memory = new Map<string, string>();

const store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =
  typeof localStorage !== 'undefined'
    ? localStorage
    : {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => {
          memory.set(key, value);
        },
        removeItem: (key) => {
          memory.delete(key);
        },
      };

function resolveKey(key: StorageKey): string {
  return KEYS[key];
}

export function getItem(key: StorageKey): string | null {
  try {
    return store.getItem(resolveKey(key));
  } catch {
    return null;
  }
}

export function setItem(key: StorageKey, value: string): void {
  try {
    store.setItem(resolveKey(key), value);
  } catch {
    // Storage may be unavailable in some privacy modes.
  }
}

export function removeItem(key: StorageKey): void {
  try {
    store.removeItem(resolveKey(key));
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
  return store;
}
