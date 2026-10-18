import { getJson, removeItem, setJson } from './storage';
import { resolveCollegeId } from './supabase/colleges';
import type { SessionFoodRule } from './supabase/foodFilters';
import {
  listMyFoodRules,
  setDiscountEligibility,
  setMyFoodRules,
  updateMyProfile,
} from './supabase/profiles';
import type { Profile } from './types';

export type GuestOnboardingDraft = {
  foodRules: SessionFoodRule[];
  discountCodes: string[];
  cashbackBps: number | null;
  collegeId: string | null;
  collegeName: string | null;
  transportModes: string[];
  maxStores: number | null;
};

const EMPTY: GuestOnboardingDraft = {
  foodRules: [],
  discountCodes: [],
  cashbackBps: null,
  collegeId: null,
  collegeName: null,
  transportModes: [],
  maxStores: null,
};

function isFoodRule(value: unknown): value is SessionFoodRule {
  if (!value || typeof value !== 'object') return false;
  const row = value as SessionFoodRule;
  return typeof row.trait_id === 'string' && typeof row.mode === 'string';
}

function normalizeDraft(raw: unknown): GuestOnboardingDraft {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const row = raw as Partial<GuestOnboardingDraft>;
  const foodRules = Array.isArray(row.foodRules) ? row.foodRules.filter(isFoodRule) : [];
  const discountCodes = Array.isArray(row.discountCodes)
    ? row.discountCodes.filter((code): code is string => typeof code === 'string')
    : [];
  const transportModes = Array.isArray(row.transportModes)
    ? row.transportModes.filter((mode): mode is string => typeof mode === 'string')
    : [];
  return {
    foodRules,
    discountCodes,
    cashbackBps: typeof row.cashbackBps === 'number' ? row.cashbackBps : null,
    collegeId: typeof row.collegeId === 'string' ? row.collegeId : null,
    collegeName: typeof row.collegeName === 'string' ? row.collegeName : null,
    transportModes,
    maxStores: typeof row.maxStores === 'number' ? row.maxStores : null,
  };
}

/** Guest onboarding choices kept on-device until they create an account. */
export function getGuestOnboardingDraft(): GuestOnboardingDraft {
  return normalizeDraft(getJson('guestOnboarding'));
}

export function getGuestFoodRules(): SessionFoodRule[] {
  return getGuestOnboardingDraft().foodRules;
}

export function saveGuestOnboardingDraft(draft: GuestOnboardingDraft): void {
  setJson('guestOnboarding', normalizeDraft(draft));
}

export function clearGuestOnboardingDraft(): void {
  removeItem('guestOnboarding');
}

/**
 * Copies guest onboarding prefs into the signed-in profile / food rules.
 * Food rules merge in when the account has none for that trait; other fields
 * fill empty profile slots only.
 */
export async function mergeGuestOnboardingIntoAccount(): Promise<void> {
  const draft = getGuestOnboardingDraft();
  const hasAnything =
    draft.foodRules.length > 0 ||
    draft.discountCodes.length > 0 ||
    draft.cashbackBps != null ||
    draft.collegeId != null ||
    draft.collegeName != null ||
    draft.transportModes.length > 0 ||
    draft.maxStores != null;
  if (!hasAnything) return;

  if (draft.foodRules.length > 0) {
    const existing = await listMyFoodRules();
    const byTrait = new Map(existing.map((rule) => [rule.trait_id, rule.mode]));
    for (const rule of draft.foodRules) {
      if (!byTrait.has(rule.trait_id)) {
        byTrait.set(rule.trait_id, rule.mode);
      }
    }
    await setMyFoodRules(
      [...byTrait.entries()].map(([traitId, mode]) => ({ traitId, mode })),
    );
  }

  for (const code of draft.discountCodes) {
    try {
      await setDiscountEligibility(code, true);
    } catch {
      // Ignore unknown / rejected discount codes.
    }
  }

  let resolvedCollegeId: string | null = null;
  if (draft.discountCodes.includes('student')) {
    try {
      resolvedCollegeId = await resolveCollegeId({
        collegeId: draft.collegeId,
        collegeName: draft.collegeName,
      });
    } catch {
      resolvedCollegeId = draft.collegeId;
    }
  }

  const allowedModes = new Set([
    'walk',
    'bike',
    'drive',
    'transit',
    'rideshare',
    'delivered',
  ] as const);
  type Mode = NonNullable<Profile['transport_mode']>;
  const modes = draft.transportModes.filter((mode): mode is Mode =>
    allowedModes.has(mode as Mode),
  );
  const primaryMode = modes[0] ?? null;
  const patch: Partial<
    Pick<
      Profile,
      | 'college_id'
      | 'transport_mode'
      | 'transport_modes'
      | 'max_stores_per_trip'
      | 'grocery_cashback_bps'
    >
  > = {};

  if (resolvedCollegeId) patch.college_id = resolvedCollegeId;
  if (primaryMode) {
    patch.transport_mode = primaryMode;
    patch.transport_modes = modes;
  }
  if (draft.maxStores != null) patch.max_stores_per_trip = draft.maxStores;
  if (draft.cashbackBps != null) patch.grocery_cashback_bps = draft.cashbackBps;

  if (Object.keys(patch).length > 0) {
    try {
      await updateMyProfile(patch);
    } catch {
      // Non-blocking; food rules above are the critical path.
    }
  }

  clearGuestOnboardingDraft();
}
