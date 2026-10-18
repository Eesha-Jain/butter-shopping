import type { Group, GroupBalance, GroupKind, GroupMember } from '../types';
import { fail } from '../errors';
import { supabase } from './client';
import { unwrap, unwrapOne, unwrapVoid } from './query';

export type GroupMemberWithProfile = GroupMember & {
  display_name: string | null;
  avatar_path: string | null;
};

async function requireSignedIn(message: string): Promise<void> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    fail(message);
  }
}

/**
 * Groups the caller belongs to, including the personal group created at signup.
 * A personal group is the solo shopping account; household and event groups are shared.
 */
export async function listMyGroups(): Promise<Group[]> {
  return unwrap(await supabase.from('groups').select('*').order('created_at'));
}

/** One group the caller can read (must be a member via RLS). */
export async function getGroup(groupId: string): Promise<Group> {
  return unwrapOne(
    await supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
    'Group not found.',
  );
}

/**
 * Creates a household or event, adds the caller as owner, and creates its default
 * list. Do not insert into groups yourself. Returns the new group id.
 */
export async function createGroup(input: {
  name: string;
  kind: Extract<GroupKind, 'household' | 'event'>;
}): Promise<string> {
  await requireSignedIn('Sign up or log in to create a shared grocery party.');
  return unwrap(
    await supabase.rpc('create_group', { p_name: input.name, p_kind: input.kind }),
  );
}

/**
 * Joins an open group by invite code and returns its id. Food rules and budgets
 * are not copied from the other members.
 */
export async function joinGroup(inviteCode: string): Promise<string> {
  await requireSignedIn('Sign up or log in to join a shared grocery party.');
  return unwrap(await supabase.rpc('join_group', { p_invite_code: inviteCode }));
}

/**
 * Leaves a household or event. The personal group cannot be left.
 */
export async function leaveGroup(groupId: string): Promise<void> {
  unwrapVoid(await supabase.rpc('leave_group', { p_group_id: groupId }));
}

/** Members of a group the caller belongs to. */
export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  return unwrap(await supabase.from('group_members').select('*').eq('group_id', groupId));
}

/**
 * Members plus display name / avatar for the roster UI.
 * Requires profiles_read_group_peers RLS so co-member profiles are visible.
 */
export async function listGroupMembersWithProfiles(
  groupId: string,
): Promise<GroupMemberWithProfile[]> {
  const members = unwrap(
    await supabase.from('group_members').select('*').eq('group_id', groupId).order('created_at'),
  );
  if (members.length === 0) {
    return [];
  }
  const userIds = members.map((row) => row.user_id);
  const profiles = unwrap(
    await supabase.from('profiles').select('id, display_name, avatar_path').in('id', userIds),
  );
  const byId = new Map(profiles.map((row) => [row.id, row]));
  return members.map((member) => {
    const profile = byId.get(member.user_id);
    return {
      ...member,
      display_name: profile?.display_name ?? null,
      avatar_path: profile?.avatar_path ?? null,
    };
  });
}

/**
 * Owner-only changes to the group name or closed_at. Setting closed_at stops
 * new people from joining; it does not delete lists or balances.
 */
export async function updateGroup(
  groupId: string,
  patch: Partial<Pick<Group, 'name' | 'closed_at'>>,
): Promise<Group> {
  return unwrapOne(
    await supabase.from('groups').update(patch).eq('id', groupId).select('*').maybeSingle(),
    'Group update did not return a row. Only an owner can update a group.',
  );
}

/**
 * Unpaid expense shares in a group. user_id owes paid_by. The payer has no
 * balance against themselves. Amounts were frozen when each order was placed.
 */
export async function listGroupBalances(groupId: string): Promise<GroupBalance[]> {
  return unwrap(await supabase.from('v_group_balances').select('*').eq('group_id', groupId));
}
