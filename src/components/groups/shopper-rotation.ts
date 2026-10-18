import {
  listGroupMembersWithProfiles,
  listGroupOrders,
  publicImageUrl,
  type GroupMemberWithProfile,
  type GroupOrderRow,
} from '@/backend';

/**
 * Shopper rotation for shared groups. Nothing new is stored: turn order is the
 * order people joined (group_members.created_at), and the "last shopper" is
 * whoever paid for the most recent placed order (orders.paid_by). Everyone in
 * the group derives the same answer, and it advances once someone actually shops.
 */

export type RotationMember = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export type ShopperRotation = {
  /** Members in turn order (join order). */
  members: RotationMember[];
  /** user_id of whoever paid for the latest placed order, if any. */
  lastShopperId: string | null;
  /** Placed orders by planned_for date, so past/today runs show who really went. */
  paidByYmd: Map<string, string>;
};

export function toRotationMember(member: GroupMemberWithProfile): RotationMember {
  return {
    userId: member.user_id,
    name: member.display_name?.trim() || 'Member',
    avatarUrl: publicImageUrl('avatars', member.avatar_path),
  };
}

export function buildRotation(
  members: GroupMemberWithProfile[],
  placedOrders: Pick<GroupOrderRow, 'planned_for' | 'placed_at' | 'paid_by'>[],
): ShopperRotation {
  const memberIds = new Set(members.map((member) => member.user_id));
  const paid = placedOrders
    .filter((order): order is typeof order & { paid_by: string } =>
      Boolean(order.paid_by && memberIds.has(order.paid_by)),
    )
    .sort(
      (a, b) =>
        a.planned_for.localeCompare(b.planned_for) ||
        (a.placed_at ?? '').localeCompare(b.placed_at ?? ''),
    );

  const paidByYmd = new Map<string, string>();
  for (const order of paid) paidByYmd.set(order.planned_for, order.paid_by);

  return {
    members: members.map(toRotationMember),
    lastShopperId: paid.at(-1)?.paid_by ?? null,
    paidByYmd,
  };
}

/** Members starting with whoever is up next. */
export function upNextOrder(rotation: ShopperRotation): RotationMember[] {
  const { members, lastShopperId } = rotation;
  if (members.length === 0) return [];
  const lastIndex = members.findIndex((member) => member.userId === lastShopperId);
  const start = lastIndex === -1 ? 0 : (lastIndex + 1) % members.length;
  return [...members.slice(start), ...members.slice(0, start)];
}

/**
 * Assigns a shopper to each grocery day (YYYY-MM-DD). A day that already has a
 * placed order keeps whoever paid; the rest take turns after them.
 */
export function assignShoppers(
  rotation: ShopperRotation,
  groceryYmds: string[],
): Map<string, RotationMember> {
  const out = new Map<string, RotationMember>();
  const { members } = rotation;
  if (members.length === 0 || groceryYmds.length === 0) return out;

  const indexById = new Map(members.map((member, index) => [member.userId, index]));
  const days = [...groceryYmds].sort();

  // Turn pointer starts after the last person who shopped before this window.
  let lastBefore: string | null = null;
  for (const [ymd, userId] of [...rotation.paidByYmd].sort(([a], [b]) => a.localeCompare(b))) {
    if (ymd < days[0]) lastBefore = userId;
  }
  const lastIndex = lastBefore != null ? indexById.get(lastBefore) : undefined;
  let cursor = lastIndex != null ? (lastIndex + 1) % members.length : 0;

  for (const ymd of days) {
    const paidBy = rotation.paidByYmd.get(ymd);
    const paidIndex = paidBy != null ? indexById.get(paidBy) : undefined;
    const index = paidIndex ?? cursor;
    out.set(ymd, members[index]);
    cursor = (index + 1) % members.length;
  }
  return out;
}

export async function loadShopperRotation(groupId: string): Promise<ShopperRotation> {
  const [members, orders] = await Promise.all([
    listGroupMembersWithProfiles(groupId),
    listGroupOrders(groupId, { status: 'ordered' }).catch(() => [] as GroupOrderRow[]),
  ]);
  return buildRotation(members, orders);
}
