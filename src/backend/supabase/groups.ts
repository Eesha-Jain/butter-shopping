import type { Group, GroupBalance, GroupKind, GroupMember } from './database.types';
import { supabase } from './client';
import { unwrap, unwrapOne, unwrapVoid } from './query';

/**
 * Groups the caller belongs to, including the personal group created at signup.
 * A personal group is the solo shopping account; household and event groups are shared.
 */
export async function listMyGroups(): Promise<Group[]> {
  return unwrap(await supabase.from('groups').select('*').order('created_at'));
}

/**
 * Creates a household or event, adds the caller as owner, and creates its default
 * list. Do not insert into groups yourself. Returns the new group id.
 */
export async function createGroup(input: {
  name: string;
  kind: Extract<GroupKind, 'household' | 'event'>;
}): Promise<string> {
  return unwrap(
    await supabase.rpc('create_group', { p_name: input.name, p_kind: input.kind }),
  );
}

/**
 * Joins an open group by invite code and returns its id. Food rules and budgets
 * are not copied from the other members.
 */
export async function joinGroup(inviteCode: string): Promise<string> {
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
