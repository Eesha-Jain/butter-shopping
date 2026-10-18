import type { GroupOrderRow, ResolvedListItem, ShoppingPlanLine } from '@/backend';
import type { RotationMember } from '@/components/groups/shopper-rotation';

/**
 * One order on the Plan: a store run for one list on one grocery day.
 * - planned: priced by recommend_shopping_plan, not placed yet
 * - unpriced: items no store can price yet (cannot be ordered)
 * - placed: an `ordered` row from v_order_summary
 */
export type RunOrderKind = 'planned' | 'unpriced' | 'placed';

export type RunOrderLine = {
  item: ResolvedListItem;
  lineCents: number | null;
};

export type RunOrder = {
  key: string;
  kind: RunOrderKind;
  ymd: string;
  groupId: string;
  groupName: string;
  /** Group name, plus the list name when a group owns several lists. */
  sourceLabel: string;
  isShared: boolean;
  listId: string | null;
  storeId: string | null;
  storeName: string;
  /** Planned/unpriced only; placed lines load on demand. */
  lines: RunOrderLine[];
  itemCount: number;
  totalCents: number;
  shopper: RotationMember | null;
  /** True while this run's store picks are still loading. */
  pending: boolean;
  placed: GroupOrderRow | null;
};

export type StoreOrderGroup = {
  key: string;
  storeId: string | null;
  storeName: string;
  orders: RunOrder[];
};

export type RunSource = {
  listId: string;
  groupId: string;
  groupName: string;
  sourceLabel: string;
  isShared: boolean;
};

export function runKey(listId: string, ymd: string): string {
  return `${listId}|${ymd}`;
}

export function groupRunOrdersByStore(orders: RunOrder[]): StoreOrderGroup[] {
  const groups = new Map<string, StoreOrderGroup>();
  for (const order of orders) {
    const storeKey = order.storeId
      ? `store:${order.storeId}`
      : `${order.kind}:${order.storeName.trim().toLocaleLowerCase()}`;
    const group = groups.get(storeKey) ?? {
      key: storeKey,
      storeId: order.storeId,
      storeName: order.storeName,
      orders: [],
    };
    group.orders.push(order);
    groups.set(storeKey, group);
  }
  return [...groups.values()];
}

/** Splits one list's items for one run into per-store orders. */
export function buildRunOrders(input: {
  source: RunSource;
  ymd: string;
  items: ResolvedListItem[];
  /** Undefined while pricing is still loading. */
  lines: ShoppingPlanLine[] | undefined;
  storeNames: Map<string, string>;
  shopper: RotationMember | null;
}): RunOrder[] {
  const { source, ymd, items, lines, storeNames, shopper } = input;
  if (items.length === 0) return [];

  const base = {
    ymd,
    groupId: source.groupId,
    groupName: source.groupName,
    sourceLabel: source.sourceLabel,
    isShared: source.isShared,
    listId: source.listId,
    shopper,
    placed: null,
  };

  if (!lines) {
    return [
      {
        ...base,
        key: `${runKey(source.listId, ymd)}|pending`,
        kind: 'unpriced',
        storeId: null,
        storeName: 'Finding the best store…',
        lines: items.map((item) => ({ item, lineCents: item.best_price_cents })),
        itemCount: items.length,
        totalCents: 0,
        pending: true,
      },
    ];
  }

  const lineByItem = new Map(lines.map((line) => [line.list_item_id, line]));
  const byStore = new Map<string | null, RunOrderLine[]>();
  for (const item of items) {
    const line = lineByItem.get(item.id);
    const storeId = line?.store_product_id ? (line.store_id ?? null) : null;
    const bucket = byStore.get(storeId) ?? [];
    bucket.push({ item, lineCents: storeId ? (line?.line_cents ?? null) : null });
    byStore.set(storeId, bucket);
  }

  const orders: RunOrder[] = [];
  for (const [storeId, storeLines] of byStore) {
    orders.push({
      ...base,
      key: `${runKey(source.listId, ymd)}|${storeId ?? 'unpriced'}`,
      kind: storeId ? 'planned' : 'unpriced',
      storeId,
      storeName: storeId ? (storeNames.get(storeId) ?? 'Store') : 'No store price yet',
      lines: storeLines,
      itemCount: storeLines.length,
      totalCents: storeLines.reduce((sum, line) => sum + (line.lineCents ?? 0), 0),
      pending: false,
    });
  }
  return orders.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'planned' ? -1 : 1;
    return b.itemCount - a.itemCount || b.totalCents - a.totalCents;
  });
}

export function placedRunOrder(input: {
  row: GroupOrderRow;
  groupName: string;
  isShared: boolean;
  shopper: RotationMember | null;
}): RunOrder {
  const { row } = input;
  return {
    key: `placed|${row.order_id}`,
    kind: 'placed',
    ymd: row.planned_for,
    groupId: row.group_id,
    groupName: input.groupName,
    sourceLabel: input.groupName,
    isShared: input.isShared,
    listId: null,
    storeId: row.store_id,
    storeName: row.store_name,
    lines: [],
    itemCount: row.item_count,
    totalCents: row.total_cents,
    shopper: input.shopper,
    pending: false,
    placed: row,
  };
}
