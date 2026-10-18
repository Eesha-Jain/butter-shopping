import type { DiscountEligibility, FoodTrait, Profile, UserFoodRule, UserLocation } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne, unwrapVoid } from './query';

/**
 * The signed-in profile. weekly_budget_cents is the grocery spending target.
 * dining_plan_id only names a college plan; it does not store a balance.
 */
export async function getMyProfile(): Promise<Profile> {
  const userId = await requireUserId();
  return unwrapOne(
    await supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    'Profile not found. New accounts receive one from the signup trigger.',
  );
}

/**
 * Updates settings the user is allowed to change. The id cannot be changed.
 * preferred_days uses 0 for Sunday through 6 for Saturday.
 */
export async function updateMyProfile(
  patch: Partial<
    Pick<
      Profile,
      | 'display_name'
      | 'college_id'
      | 'dining_plan_id'
      | 'weekly_budget_cents'
      | 'preferred_days'
      | 'max_stores_per_trip'
      | 'transport_mode'
      | 'transport_modes'
      | 'grocery_cashback_bps'
      | 'onboarding_completed_at'
    >
  >,
): Promise<Profile> {
  const userId = await requireUserId();
  return unwrapOne(
    await supabase.from('profiles').update(patch).eq('id', userId).select('*').maybeSingle(),
    'Profile update did not return a row.',
  );
}

/**
 * Uploads a profile image to avatars/<user id>/avatar and stores that path on
 * the profile. The bytes stay in Storage, not in the profiles table.
 */
export async function uploadMyAvatar(input: {
  data: ArrayBuffer;
  contentType: string;
}): Promise<string> {
  const userId = await requireUserId();
  const path = `${userId}/avatar`;
  const uploaded = await supabase.storage.from('avatars').upload(path, input.data, {
    contentType: input.contentType,
    upsert: true,
  });
  if (uploaded.error) fail(uploaded.error, 'Could not upload the avatar.');
  unwrapOne(
    await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId).select('id').maybeSingle(),
    'Avatar path was not saved.',
  );
  return path;
}

/**
 * Removes the avatar file and clears profiles.avatar_path.
 */
export async function removeMyAvatar(): Promise<void> {
  const profile = await getMyProfile();
  if (profile.avatar_path) {
    const removed = await supabase.storage.from('avatars').remove([profile.avatar_path]);
    if (removed.error) fail(removed.error, 'Could not remove the avatar.');
  }
  unwrapOne(
    await supabase
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', profile.id)
      .select('id')
      .maybeSingle(),
    'Avatar path was not cleared.',
  );
}

/**
 * Public URL for an avatar or public-assets path. Returns null when no path is stored.
 * Absolute http(s) URLs (retailer product images stored in image_path) pass through.
 */
export function publicImageUrl(bucket: 'avatars' | 'public-assets', path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path.trim())) return path.trim();
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Replaces the caller's private food rules. Each trait must use a legal mode:
 * avoid for ingredients, allergens, and chemicals; require or prefer for
 * dietary properties and certifications. The database rejects other combinations.
 */
export async function setMyFoodRules(
  rules: { traitId: string; mode: UserFoodRule['mode'] }[],
): Promise<void> {
  const userId = await requireUserId();
  unwrapVoid(await supabase.from('user_food_rules').delete().eq('user_id', userId));
  if (rules.length === 0) return;
  unwrapVoid(
    await supabase.from('user_food_rules').insert(
      rules.map((rule) => ({ user_id: userId, trait_id: rule.traitId, mode: rule.mode })),
    ),
  );
}

/**
 * The caller's private food rules. Other group members cannot read this table;
 * shared planning uses them only inside recommend_shopping_plan.
 */
export async function listMyFoodRules(): Promise<UserFoodRule[]> {
  const userId = await requireUserId();
  return unwrap(await supabase.from('user_food_rules').select('*').eq('user_id', userId));
}

/**
 * Filter vocabulary. This is reference data, safe for any signed-in user.
 * Categories are a different table and are not included here.
 */
export async function listFoodTraits(): Promise<FoodTrait[]> {
  return unwrap(await supabase.from('food_traits').select('*').order('name'));
}

/**
 * Records that the caller may use a discount such as a student discount.
 * This stays private to the caller.
 */
export async function setDiscountEligibility(groupCode: string, optedIn: boolean): Promise<void> {
  const userId = await requireUserId();
  if (optedIn) {
    unwrapVoid(
      await supabase.from('discount_eligibilities').upsert({
        user_id: userId,
        group_code: groupCode.toLowerCase(),
        consented_at: new Date().toISOString(),
      }),
    );
    return;
  }
  unwrapVoid(
    await supabase
      .from('discount_eligibilities')
      .delete()
      .eq('user_id', userId)
      .eq('group_code', groupCode.toLowerCase()),
  );
}

/** The caller's saved discount opt-ins. */
export async function listMyDiscountEligibilities(): Promise<DiscountEligibility[]> {
  const userId = await requireUserId();
  return unwrap(await supabase.from('discount_eligibilities').select('*').eq('user_id', userId));
}

/**
 * Saves an address for the caller. When isDefault is true, older default rows
 * are cleared first so nearby search has one home location.
 */
export async function saveMyLocation(
  input: Omit<UserLocation, 'id' | 'user_id' | 'created_at' | 'updated_at'>,
): Promise<UserLocation> {
  const userId = await requireUserId();
  if (input.is_default) {
    unwrapVoid(
      await supabase.from('user_locations').update({ is_default: false }).eq('user_id', userId),
    );
  }
  return unwrapOne(
    await supabase
      .from('user_locations')
      .insert({ ...input, user_id: userId })
      .select('*')
      .maybeSingle(),
    'Location insert did not return a row.',
  );
}

/** Addresses saved by the caller. */
export async function listMyLocations(): Promise<UserLocation[]> {
  const userId = await requireUserId();
  return unwrap(await supabase.from('user_locations').select('*').eq('user_id', userId));
}

/**
 * Remembers a preferred store. This does not limit shopping plans by itself.
 */
export async function preferStore(storeId: string): Promise<void> {
  const userId = await requireUserId();
  unwrapVoid(await supabase.from('user_stores').upsert({ user_id: userId, store_id: storeId }));
}

/** Removes one preferred store. */
export async function unpreferStore(storeId: string): Promise<void> {
  const userId = await requireUserId();
  unwrapVoid(await supabase.from('user_stores').delete().eq('user_id', userId).eq('store_id', storeId));
}

async function requireUserId(): Promise<string> {
  const result = await supabase.auth.getUser();
  if (result.error || !result.data.user) {
    fail(result.error ?? 'Sign in first.');
  }
  return result.data.user.id;
}
