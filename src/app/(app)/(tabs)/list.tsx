import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveList } from '@/auth/active-list';
import { useGuestCart } from '@/auth/guest-cart-context';
import { useSession } from '@/auth/session';
import {
  getCheapestShelfSaleByProductIds,
  getMyProfile,
  getProductsByIds,
  getStoreNames,
  listExpiringPurchases,
  listGroupMembersWithProfiles,
  listGroupOrders,
  listHabits,
  listOrderItems,
  listOrderShares,
  listResolvedItems,
  placeRunOrder,
  recommendShoppingPlan,
  removeListItem,
  resolveShopZip,
  setListItemDone,
  showErrorToast,
  showSuccessToast,
  suggestBestShopDate,
  suggestDiscountDate,
  todayLocalDateKey,
  type ActiveListTarget,
  type BestShopDay,
  type ExpiringPurchase,
  type Group,
  type GroupOrderRow,
  type ItemHabit,
  type OrderItem,
  type OrderShare,
  type ResolvedListItem,
  type ShoppingPlanLine,
} from '@/backend';
import { MemberAvatar } from '@/components/groups/member-avatar';
import {
  assignShoppers,
  buildRotation,
  type RotationMember,
  type ShopperRotation,
} from '@/components/groups/shopper-rotation';
import {
  assignGroceryDay,
  buildGroceryDays,
  parseYmd,
  type GroceryDayPlan,
} from '@/components/plan/grocery-days';
import { DayFiltersDrawer } from '@/components/plan/day-filters-drawer';
import { ListItemRow, cadenceLabel } from '@/components/plan/list-item-row';
import {
  ShoppingCompleteOverlay,
  type CelebrationOrigin,
} from '@/components/plan/shopping-complete-overlay';
import {
  buildRunOrders,
  groupRunOrdersByStore,
  placedRunOrder,
  runKey,
  type RunOrder,
  type RunOrderLine,
  type StoreOrderGroup,
} from '@/components/plan/plan-orders';
import { drawerLayout, RunOrderCard } from '@/components/plan/run-order-card';
import { SectionDivider } from '@/components/plan/section-divider';
import { StoreLogo } from '@/components/plan/store-logo';
import { WeekStrip, type WeekDayCell } from '@/components/plan/week-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { NativeIconButton } from '@/components/ui/native-icon-button';
import { formatSavingsCents, MIN_SAVINGS_CENTS, SavingsChip } from '@/components/ui/savings-chip';
import { BottomTabInset, Fonts, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Segment = 'calendar' | 'list' | 'past';

type ListData = {
  target: ActiveListTarget;
  items: ResolvedListItem[];
};

type GroupData = {
  group: Group;
  habits: ItemHabit[];
  placed: GroupOrderRow[];
  expiring: ExpiringPurchase[];
  rotation: ShopperRotation | null;
};

function formatShortDate(ymd: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseYmd(ymd));
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function habitKey(habit: Pick<ItemHabit, 'product_id' | 'category_id'>): string | null {
  if (habit.product_id) return `p:${habit.product_id}`;
  if (habit.category_id) return `c:${habit.category_id}`;
  return null;
}

function itemHabitKey(item: Pick<ResolvedListItem, 'product_id' | 'category_id'>): string | null {
  if (item.product_id) return `p:${item.product_id}`;
  if (item.category_id) return `c:${item.category_id}`;
  return null;
}

function itemTitle(item: ResolvedListItem): string {
  return item.display_name?.trim() || item.custom_name?.trim() || 'Item';
}

function storeFilterKey(order: Pick<RunOrder, 'storeId' | 'storeName'>): string {
  return order.storeId
    ? `store-id:${order.storeId}`
    : `store-name:${order.storeName.trim().toLocaleLowerCase()}`;
}

function buildWeekCells(input: {
  todayYmd: string;
  plan: GroceryDayPlan;
  ordersByDay: Map<string, RunOrder[]>;
}): WeekDayCell[] {
  return input.plan.windowYmds.map((ymd) => {
    const day = parseYmd(ymd);
    const reasons = input.plan.reasons.get(ymd) ?? [];
    const orders = input.ordersByDay.get(ymd) ?? [];
    // One avatar per cell: only when every shared order that day has the same shopper.
    const shoppers = new Map<string, RotationMember>();
    for (const order of orders) {
      if (order.shopper) shoppers.set(order.shopper.userId, order.shopper);
    }
    return {
      ymd,
      weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day),
      dayNum: String(day.getDate()),
      isToday: ymd === input.todayYmd,
      isRecommended: reasons.includes('bestPrice'),
      hasHabitsDue: reasons.includes('staples'),
      isBestDeal: reasons.includes('bestDeal'),
      isGroceryDay: reasons.length > 0,
      itemCount: orders.length,
      shopper: shoppers.size === 1 ? [...shoppers.values()][0] : null,
    };
  });
}

export default function PlanScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, isGuest, requestSignIn } = useSession();
  const myUserId = session?.user.id ?? null;
  const guestCart = useGuestCart();
  const { targets, isLoading: listsLoading } = useActiveList();

  const [segment, setSegment] = useState<Segment>('calendar');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [lists, setLists] = useState<ListData[]>([]);
  const [completedItemIds, setCompletedItemIds] = useState<Set<string>>(() => new Set());
  const [celebration, setCelebration] = useState<CelebrationOrigin | null>(null);
  const [groupsData, setGroupsData] = useState<Map<string, GroupData>>(() => new Map());
  const [preferredDays, setPreferredDays] = useState<number[] | null>(null);
  const [bestShopDay, setBestShopDay] = useState<BestShopDay | null>(null);
  const [bestDealYmd, setBestDealYmd] = useState<string | null>(null);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [selectedGroupFilters, setSelectedGroupFilters] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedStoreFilters, setSelectedStoreFilters] = useState<Set<string>>(
    () => new Set(),
  );
  const [productImages, setProductImages] = useState<Map<string, string | null>>(() => new Map());
  const [productNames, setProductNames] = useState<Map<string, string>>(() => new Map());
  /** Unit cents saved (regular − shelf) by product id. */
  const [unitSavingsByProduct, setUnitSavingsByProduct] = useState<Map<string, number>>(
    () => new Map(),
  );

  /** recommend_shopping_plan results by runKey(listId, ymd). */
  const [linesByRun, setLinesByRun] = useState<Map<string, ShoppingPlanLine[]>>(() => new Map());
  const [storeNames, setStoreNames] = useState<Map<string, string>>(() => new Map());
  const requestedRuns = useRef(new Set<string>());
  const loadGeneration = useRef(0);

  const [collapsedOrderKeys, setCollapsedOrderKeys] = useState<Set<string>>(() => new Set());
  const [placingKey, setPlacingKey] = useState<string | null>(null);

  const [pastDetail, setPastDetail] = useState<RunOrder | null>(null);
  const [pastItems, setPastItems] = useState<OrderItem[]>([]);
  const [pastShares, setPastShares] = useState<OrderShare[]>([]);

  const todayYmd = todayLocalDateKey();
  const showSource = targets.length > 1;

  const habitMapByGroup = useMemo(() => {
    const out = new Map<string, Map<string, ItemHabit>>();
    for (const [groupId, data] of groupsData) {
      const map = new Map<string, ItemHabit>();
      for (const habit of data.habits) {
        const key = habitKey(habit);
        if (key && !map.has(key)) map.set(key, habit);
      }
      out.set(groupId, map);
    }
    return out;
  }, [groupsData]);

  const itemHabit = useCallback(
    (item: ResolvedListItem, groupId: string): ItemHabit | undefined => {
      const key = itemHabitKey(item);
      return key ? habitMapByGroup.get(groupId)?.get(key) : undefined;
    },
    [habitMapByGroup],
  );

  /** Auto-add staples that are not on any of that group's lists yet. */
  const upcomingStaples = useMemo(() => {
    const out: { habit: ItemHabit; groupName: string }[] = [];
    for (const [groupId, data] of groupsData) {
      const onList = new Set(
        lists
          .filter((row) => row.target.group.id === groupId)
          .flatMap((row) => row.items.map(itemHabitKey))
          .filter(Boolean),
      );
      for (const habit of data.habits) {
        const key = habitKey(habit);
        if (habit.auto_add_enabled && habit.next_due_on && key && !onList.has(key)) {
          out.push({ habit, groupName: data.group.name });
        }
      }
    }
    return out;
  }, [groupsData, lists]);

  const upcomingPlaced = useMemo(
    () =>
      [...groupsData.values()].flatMap((data) =>
        data.placed.filter((row) => row.status === 'ordered' && row.planned_for >= todayYmd),
      ),
    [groupsData, todayYmd],
  );

  const groceryPlan = useMemo(
    () =>
      buildGroceryDays({
        todayYmd,
        preferredDays,
        bestShopYmd: bestShopDay?.shopOn ?? null,
        bestDealYmd,
        stapleDueYmds: [
          ...lists.flatMap((row) =>
            row.items
              .filter((item) => !item.done_at)
              .map((item) => itemHabit(item, row.target.group.id)?.next_due_on ?? null),
          ),
          ...upcomingStaples.map(({ habit }) => habit.next_due_on),
        ].filter((ymd): ymd is string => Boolean(ymd)),
        orderedYmds: upcomingPlaced.map((row) => row.planned_for),
      }),
    [todayYmd, preferredDays, bestShopDay?.shopOn, bestDealYmd, lists, upcomingStaples, upcomingPlaced, itemHabit],
  );

  /** Open items per list, split onto grocery runs. */
  const runsByList = useMemo(
    () =>
      lists.map((row) => {
        const runs = new Map<string, ResolvedListItem[]>();
        for (const item of row.items) {
          if (item.done_at) continue;
          const due = itemHabit(item, row.target.group.id)?.next_due_on ?? null;
          const ymd = assignGroceryDay(groceryPlan, due);
          runs.set(ymd, [...(runs.get(ymd) ?? []), item]);
        }
        return { target: row.target, runs };
      }),
    [lists, groceryPlan, itemHabit],
  );

  const shoppersByGroup = useMemo(() => {
    const out = new Map<string, Map<string, RotationMember>>();
    for (const [groupId, data] of groupsData) {
      if (data.rotation) out.set(groupId, assignShoppers(data.rotation, groceryPlan.days));
    }
    return out;
  }, [groupsData, groceryPlan.days]);

  const ordersByDay = useMemo(() => {
    const out = new Map<string, RunOrder[]>();
    const push = (ymd: string, orders: RunOrder[]) => {
      if (orders.length > 0) out.set(ymd, [...(out.get(ymd) ?? []), ...orders]);
    };
    const groupListCount = new Map<string, number>();
    for (const { target } of runsByList) {
      groupListCount.set(target.group.id, (groupListCount.get(target.group.id) ?? 0) + 1);
    }
    for (const { target, runs } of runsByList) {
      const multipleLists = (groupListCount.get(target.group.id) ?? 0) > 1;
      const source = {
        listId: target.list.id,
        groupId: target.group.id,
        groupName: target.group.name,
        sourceLabel: multipleLists ? `${target.group.name} · ${target.list.name}` : target.group.name,
        isShared: target.group.kind !== 'personal',
      };
      for (const [ymd, items] of runs) {
        push(
          ymd,
          buildRunOrders({
            source,
            ymd,
            items,
            lines: linesByRun.get(runKey(target.list.id, ymd)),
            storeNames,
            shopper: shoppersByGroup.get(target.group.id)?.get(ymd) ?? null,
          }),
        );
      }
    }
    for (const row of upcomingPlaced) {
      const data = groupsData.get(row.group_id);
      push(row.planned_for, [
        placedRunOrder({
          row,
          groupName: data?.group.name ?? 'Group',
          isShared: data?.group.kind !== 'personal',
          shopper: data?.rotation?.members.find((member) => member.userId === row.paid_by) ?? null,
        }),
      ]);
    }
    for (const orders of out.values()) {
      orders.sort(
        (a, b) =>
          a.sourceLabel.localeCompare(b.sourceLabel) ||
          Number(a.kind === 'placed') - Number(b.kind === 'placed'),
      );
    }
    return out;
  }, [runsByList, linesByRun, storeNames, shoppersByGroup, upcomingPlaced, groupsData]);

  const pastOrders = useMemo(
    () =>
      [...groupsData.values()]
        .flatMap((data) =>
        data.placed
          .filter((row) => row.status === 'complete' || row.status === 'ordered')
          .map((row) =>
            placedRunOrder({
              row,
              groupName: data.group.name,
              isShared: data.group.kind !== 'personal',
              shopper:
                data.rotation?.members.find((member) => member.userId === row.paid_by) ?? null,
            }),
          ),
      )
      .sort((a, b) => b.ymd.localeCompare(a.ymd)),
    [groupsData],
  );

  const itemById = useMemo(() => {
    const map = new Map<string, ResolvedListItem>();
    for (const row of lists) for (const item of row.items) map.set(item.id, item);
    return map;
  }, [lists]);

  // Price each run once: one recommend_shopping_plan call per list and grocery day.
  useEffect(() => {
    const needed: { listId: string; ymd: string; key: string }[] = [];
    for (const { target, runs } of runsByList) {
      for (const ymd of runs.keys()) {
        const key = runKey(target.list.id, ymd);
        if (!linesByRun.has(key) && !requestedRuns.current.has(key)) {
          needed.push({ listId: target.list.id, ymd, key });
        }
      }
    }
    if (needed.length === 0) return;
    for (const run of needed) requestedRuns.current.add(run.key);
    const generation = loadGeneration.current;

    void (async () => {
      const entries = await Promise.all(
        needed.map(
          async (run) =>
            [
              run.key,
              await recommendShoppingPlan({ listId: run.listId, plannedFor: run.ymd }).catch(
                () => [] as ShoppingPlanLine[],
              ),
            ] as const,
        ),
      );
      const storeIds = entries.flatMap(([, lines]) =>
        lines.map((line) => line.store_id).filter((id): id is string => Boolean(id)),
      );
      const names = await getStoreNames(storeIds).catch(() => new Map<string, string>());
      if (generation !== loadGeneration.current) return;
      setStoreNames((prev) => new Map([...prev, ...names]));
      setLinesByRun((prev) => new Map([...prev, ...entries]));
    })();
  }, [runsByList, linesByRun]);

  const activeYmd =
    selectedYmd && groceryPlan.windowYmds.includes(selectedYmd)
      ? selectedYmd
      : groceryPlan.primaryYmd;
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');
  const selectDay = useCallback(
    (ymd: string) => {
      setSlideDir(ymd < activeYmd ? 'back' : 'forward');
      if (ymd !== activeYmd) {
        setSelectedGroupFilters(new Set());
        setSelectedStoreFilters(new Set());
      }
      setSelectedYmd(ymd);
    },
    [activeYmd],
  );
  const activeReasons = useMemo(
    () => groceryPlan.reasons.get(activeYmd) ?? [],
    [groceryPlan, activeYmd],
  );
  const isGroceryDay = activeReasons.length > 0;
  const dayOrders = useMemo(() => ordersByDay.get(activeYmd) ?? [], [ordersByDay, activeYmd]);
  const dayGroupFilters = useMemo(() => {
    const groups = new Map<string, string>();
    for (const order of dayOrders) groups.set(order.groupId, order.groupName);
    return [...groups.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [dayOrders]);
  const dayStoreFilters = useMemo(() => {
    const stores = new Map<string, string>();
    for (const order of dayOrders) {
      if (!order.pending) stores.set(storeFilterKey(order), order.storeName);
    }
    return [...stores.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [dayOrders]);
  const filteredDayOrders = useMemo(
    () =>
      dayOrders.filter(
        (order) =>
          (selectedGroupFilters.size === 0 || selectedGroupFilters.has(order.groupId)) &&
          (selectedStoreFilters.size === 0 ||
            selectedStoreFilters.has(storeFilterKey(order))),
      ),
    [dayOrders, selectedGroupFilters, selectedStoreFilters],
  );
  const dayOrderGroups = useMemo(
    () => groupRunOrdersByStore(filteredDayOrders),
    [filteredDayOrders],
  );
  const openDayFilters = useCallback(() => {
    if (segment === 'calendar' && dayOrders.length > 0) setFiltersOpen(true);
  }, [dayOrders.length, segment]);
  const rightEdgeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-40, 40])
        .onEnd((event) => {
          if (event.translationX < -48) runOnJS(openDayFilters)();
        }),
    [openDayFilters],
  );
  const hasAnyOpenItems = runsByList.some(({ runs }) => runs.size > 0);

  const weekDays = useMemo(
    () => buildWeekCells({ todayYmd, plan: groceryPlan, ordersByDay }),
    [todayYmd, groceryPlan, ordersByDay],
  );

  const dayStaples = useMemo(
    () =>
      upcomingStaples
        .filter(({ habit }) => assignGroceryDay(groceryPlan, habit.next_due_on) === activeYmd)
        .sort((a, b) => a.habit.next_due_on.localeCompare(b.habit.next_due_on)),
    [upcomingStaples, groceryPlan, activeYmd],
  );

  const useSoon = useMemo(
    () =>
      [...groupsData.values()]
        .flatMap((data) => data.expiring)
        .filter((row) => row.expires_on >= activeYmd)
        .sort((a, b) => a.expires_on.localeCompare(b.expires_on))
        .slice(0, 8),
    [groupsData, activeYmd],
  );

  const lineSavingsCents = useCallback(
    (item: ResolvedListItem): number | null => {
      if (!item.product_id || item.done_at) return null;
      const unit = unitSavingsByProduct.get(item.product_id);
      if (unit == null || unit < MIN_SAVINGS_CENTS) return null;
      const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      return Math.round(unit * qty);
    },
    [unitSavingsByProduct],
  );

  const tripSavingsCents = useMemo(() => {
    const scope =
      segment === 'calendar' ? filteredDayOrders : [...ordersByDay.values()].flat();
    let sum = 0;
    for (const order of scope) {
      for (const line of order.lines) sum += lineSavingsCents(line.item) ?? 0;
    }
    return sum;
  }, [segment, filteredDayOrders, ordersByDay, lineSavingsCents]);

  const showTripSavings =
    tripSavingsCents >= MIN_SAVINGS_CENTS &&
    (segment === 'list' ||
      activeReasons.includes('bestPrice') ||
      activeReasons.includes('bestDeal'));

  const loadProductMeta = useCallback(async (productIds: string[]) => {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) {
      setProductImages(new Map());
      setProductNames(new Map());
      setUnitSavingsByProduct(new Map());
      return;
    }
    const [products, sales] = await Promise.all([
      getProductsByIds(ids).catch(() => []),
      getCheapestShelfSaleByProductIds(ids).catch(() => null),
    ]);
    setProductImages(new Map(products.map((product) => [product.id, product.image_path])));
    setProductNames(new Map(products.map((product) => [product.id, product.name])));
    const savings = new Map<string, number>();
    for (const [id, sale] of sales ?? []) {
      if (sale.regularPriceCents != null && sale.regularPriceCents > sale.priceCents) {
        savings.set(id, sale.regularPriceCents - sale.priceCents);
      }
    }
    setUnitSavingsByProduct(savings);
  }, []);

  const loadPlan = useCallback(
    async (refresh = false) => {
      if (isGuest) {
        setIsLoading(false);
        setIsRefreshing(false);
        setError(null);
        return;
      }
      if (targets.length === 0) {
        if (!listsLoading) {
          setIsLoading(false);
          setLists([]);
          setGroupsData(new Map());
        }
        return;
      }
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const zip = await resolveShopZip().catch(() => '98195');
        const uniqueGroups = [
          ...new Map(targets.map((target) => [target.group.id, target.group])).values(),
        ];
        const [listRows, groupRows, shopDay, discount, profile] = await Promise.all([
          Promise.all(
            targets.map(async (target) => ({
              target,
              items: await listResolvedItems(target.list.id),
            })),
          ),
          Promise.all(
            uniqueGroups.map(async (group): Promise<GroupData> => {
              const shared = group.kind !== 'personal';
              const [habits, placed, expiring, members] = await Promise.all([
                listHabits(group.id).catch(() => [] as ItemHabit[]),
                listGroupOrders(group.id, { status: ['ordered', 'complete'] }).catch(
                  () => [] as GroupOrderRow[],
                ),
                listExpiringPurchases(group.id).catch(() => [] as ExpiringPurchase[]),
                shared ? listGroupMembersWithProfiles(group.id).catch(() => null) : null,
              ]);
              return {
                group,
                habits,
                placed,
                expiring,
                rotation: members ? buildRotation(members, placed) : null,
              };
            }),
          ),
          suggestBestShopDate({ postalCode: zip, listId: targets[0].list.id }).catch(() => null),
          suggestDiscountDate().catch(() => null),
          getMyProfile().catch(() => null),
        ]);

        loadGeneration.current += 1;
        requestedRuns.current = new Set();
        setLinesByRun(new Map());
        setLists(listRows);
        setGroupsData(new Map(groupRows.map((row) => [row.group.id, row])));
        setBestShopDay(shopDay);
        setBestDealYmd(discount);
        setPreferredDays(profile?.preferred_days ?? null);
        void loadProductMeta(
          [
            ...listRows.flatMap((row) => row.items.map((item) => item.product_id)),
            ...groupRows.flatMap((row) => row.habits.map((habit) => habit.product_id)),
          ].filter((id): id is string => Boolean(id)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your plan.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isGuest, targets, listsLoading, loadProductMeta],
  );

  useEffect(() => {
    const timer = setTimeout(() => void loadPlan(), 0);
    return () => clearTimeout(timer);
  }, [loadPlan]);

  // Items added from the shop tab must show up when returning to the plan.
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      void loadPlan(true);
    }, [loadPlan]),
  );

  const updateItem = (itemId: string, change: (item: ResolvedListItem) => ResolvedListItem | null) => {
    setLists((rows) =>
      rows.map((row) => ({
        ...row,
        items: row.items.flatMap((item) => {
          if (item.id !== itemId) return [item];
          const next = change(item);
          return next ? [next] : [];
        }),
      })),
    );
  };

  const placeOrder = (order: RunOrder) => {
    if (!order.listId || !order.storeId || placingKey) return;
    const { listId, storeId } = order;
    const memberCount = groupsData.get(order.groupId)?.rotation?.members.length ?? 1;
    const turnNote =
      order.shopper && order.shopper.userId !== myUserId
        ? `It's ${order.shopper.name}'s turn, but you can take it. `
        : '';
    const splitNote =
      order.isShared && memberCount > 1
        ? `You'll pay and it splits evenly across ${memberCount} people.`
        : 'You pay for this order.';

    Alert.alert(
      `Order from ${order.storeName}?`,
      `${order.itemCount} item${order.itemCount === 1 ? '' : 's'} · about ${formatMoney(order.totalCents)} for ${formatShortDate(order.ymd)}.\n${turnNote}${splitNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Place order',
          onPress: () => {
            void (async () => {
              setPlacingKey(order.key);
              try {
                const { checkoutUrl } = await placeRunOrder({
                  listId,
                  plannedFor: order.ymd,
                  storeId,
                  listItemIds: order.lines.map((line) => line.item.id),
                });
                showSuccessToast('Order placed', `${order.storeName} · ${formatShortDate(order.ymd)}`);
                setCollapsedOrderKeys(new Set());
                if (checkoutUrl) void Linking.openURL(checkoutUrl).catch(() => undefined);
                await loadPlan(true);
              } catch (err) {
                showErrorToast(err, 'Could not place this order.');
              } finally {
                setPlacingKey(null);
              }
            })();
          },
        },
      ],
    );
  };

  const openPastDetail = async (order: RunOrder) => {
    if (!order.placed) return;
    setPastDetail(order);
    setPastItems([]);
    setPastShares([]);
    try {
      const [items, shares] = await Promise.all([
        listOrderItems(order.placed.order_id),
        listOrderShares(order.placed.order_id).catch(() => [] as OrderShare[]),
      ]);
      setPastItems(items);
      setPastShares(shares);
    } catch {
      setPastItems([]);
    }
  };

  const memberName = (groupId: string, userId: string): string => {
    if (userId === myUserId) return 'You';
    return (
      groupsData.get(groupId)?.rotation?.members.find((member) => member.userId === userId)?.name ??
      'Member'
    );
  };

  const renderLine = (order: RunOrder, line: RunOrderLine) => {
    const { item } = line;
    const habit = itemHabit(item, order.groupId);
    return (
      <ListItemRow
        key={item.id}
        title={itemTitle(item)}
        quantity={Number(item.quantity) || undefined}
        priceCents={line.lineCents ?? item.best_price_cents}
        savingsCents={lineSavingsCents(item)}
        imagePath={item.product_id ? productImages.get(item.product_id) : null}
        cadenceTag={habit ? cadenceLabel(habit.interval_days) : null}
        recipeTag={Boolean(item.source_recipe_id)}
        onDone={(origin) => {
          const openToday = runsByList.reduce(
            (sum, row) => sum + (row.runs.get(activeYmd)?.length ?? 0),
            0,
          );
          const isLastOfDay =
            openToday === 1 &&
            runsByList.some((row) => row.runs.get(activeYmd)?.some((i) => i.id === item.id));
          if (isLastOfDay) {
            const { width, height } = Dimensions.get('window');
            setCelebration(origin ?? { x: width / 2, y: height / 2 });
          }
          setCompletedItemIds((ids) => new Set(ids).add(item.id));
          updateItem(item.id, (current) => ({ ...current, done_at: new Date().toISOString() }));
          void setListItemDone(item.id, true).catch((err: unknown) => {
            setCompletedItemIds((ids) => {
              if (!ids.has(item.id)) return ids;
              const next = new Set(ids);
              next.delete(item.id);
              return next;
            });
            showErrorToast(err);
            void loadPlan(true);
          });
        }}
        onDelete={() => {
          updateItem(item.id, () => null);
          void removeListItem(item.id).catch((err: unknown) => {
            showErrorToast(err);
            void loadPlan(true);
          });
        }}
      />
    );
  };

  const renderOrder = (order: RunOrder, grouped = false) => (
    <RunOrderCard
      key={order.key}
      order={order}
      expanded={!collapsedOrderKeys.has(order.key)}
      placing={placingKey === order.key}
      myUserId={myUserId}
      grouped={grouped}
      showSource={showSource}
      imageForLine={(line) =>
        line.item.product_id ? (productImages.get(line.item.product_id) ?? null) : null
      }
      renderLine={(line) => renderLine(order, line)}
      onToggle={() =>
        setCollapsedOrderKeys((keys) => {
          const next = new Set(keys);
          if (next.has(order.key)) next.delete(order.key);
          else next.add(order.key);
          return next;
        })
      }
      onPlace={() => placeOrder(order)}
      onOpenPlaced={() => void openPastDetail(order)}
    />
  );

  const renderOrderGroup = (group: StoreOrderGroup) => {
    if (group.orders.length === 1) return renderOrder(group.orders[0]);
    const itemCount = group.orders.reduce((sum, order) => sum + order.itemCount, 0);
    const sourceCount = new Set(group.orders.map((order) => order.sourceLabel)).size;
    return (
      <Animated.View
        key={group.key}
        layout={drawerLayout}
        style={[
          styles.storeGroup,
          { backgroundColor: theme.background, borderColor: theme.borderInk },
        ]}>
        <View style={styles.storeGroupHeader}>
          <StoreLogo
            storeName={group.storeName}
            unknown={group.orders.every((order) => order.kind === 'unpriced')}
            size={36}
          />
          <View style={styles.storeGroupTitle}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {group.storeName}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {sourceCount} list{sourceCount === 1 ? '' : 's'} · {itemCount} item
              {itemCount === 1 ? '' : 's'}
            </ThemedText>
          </View>
        </View>
        {group.orders.map((order, index) => (
          <View
            key={order.key}
            style={[
              styles.storeGroupSection,
              index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null,
            ]}>
            {renderOrder(order, true)}
          </View>
        ))}
      </Animated.View>
    );
  };

  const emptyListBlock = (
    <View style={styles.emptyBlock}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
        Nothing to order yet. Add picks from Shop and Plan turns them into store orders.
      </ThemedText>
      <ButterButton label="Browse shop" variant="yellow" onPress={() => router.push('/')} />
      <ButterButton
        label="Import recipe"
        variant="ghost"
        onPress={() => router.push('/recipe-import')}
      />
    </View>
  );

  // Native tabs float over content; clear the bar plus the home indicator.
  const tabBarClearance = BottomTabInset + insets.bottom;

  if (isGuest) {
    return (
      <ThemedView style={[styles.root, { paddingTop: insets.top + Spacing.one }]}>
        <ScrollView
          contentContainerStyle={[styles.guestContent, { paddingBottom: tabBarClearance + Spacing.four }]}
          contentInsetAdjustmentBehavior="never">
          <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
            <ThemedText type="smallBold" style={styles.pageTitle}>
              Plan
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your picks stay on-device until you sign up. Then they sync to your grocery list.
            </ThemedText>
          </Animated.View>
          {guestCart.items.length === 0 ? (
            <View style={styles.emptyBlock}>
              <ThemedText type="smallBold">No picks yet</ThemedText>
              <ButterButton label="Browse shop" variant="yellow" onPress={() => router.push('/')} />
            </View>
          ) : (
            <View style={styles.guestCard}>
              <ThemedText type="smallBold">Your picks</ThemedText>
              {guestCart.items.map((item) => (
                <ListItemRow
                  key={item.id}
                  title={item.customName?.trim() || 'Product'}
                  quantity={item.quantity}
                  onDone={() => guestCart.removeItem(item.id)}
                  onDelete={() => guestCart.removeItem(item.id)}
                />
              ))}
            </View>
          )}
          <ButterButton label="Sign up to plan trips" variant="ink" onPress={() => requestSignIn('signUp')} />
        </ScrollView>
      </ThemedView>
    );
  }

  if ((isLoading || listsLoading) && lists.length === 0 && !error) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.secondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Loading your plan
        </ThemedText>
      </ThemedView>
    );
  }

  const upcomingDays = groceryPlan.days.filter((ymd) => (ordersByDay.get(ymd) ?? []).length > 0);

  return (
    <ThemedView style={styles.root}>
      {segment === 'calendar' && dayOrders.length > 0 ? (
        <GestureDetector gesture={rightEdgeSwipe}>
          <View
            style={[
              styles.edgeHitRight,
              { top: insets.top, bottom: BottomTabInset + insets.bottom },
            ]}
          />
        </GestureDetector>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing.one,
            paddingBottom: tabBarClearance + Spacing.four,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadPlan(true)}
            tintColor={theme.text}
          />
        }
        keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
          <View style={styles.titleRow}>
            <ThemedText type="smallBold" style={styles.pageTitle}>
              Plan
            </ThemedText>
            <View style={styles.headerActions}>
              <NativeIconButton
                accessibilityLabel="Import recipe"
                tooltipAlign="right"
                iosSymbol="text.book.closed.fill"
                androidSymbol="menu_book"
                onPress={() => router.push('/recipe-import')}
              />
              <NativeIconButton
                accessibilityLabel="Favorites"
                tooltip="Favorites"
                tooltipAlign="right"
                iosSymbol="heart.fill"
                androidSymbol="favorite"
                onPress={() => router.push('/favorites')}
              />
              <NativeIconButton
                accessibilityLabel="Manage groups"
                tooltipAlign="right"
                iosSymbol="person.2.fill"
                androidSymbol="group"
                onPress={() => router.push('/groups')}
              />
            </View>
          </View>

          {showSource ? (
            <ThemedText type="small" themeColor="textSecondary">
              Orders from all {targets.length} of your lists
            </ThemedText>
          ) : null}

          <View style={styles.segments}>
            <SegmentIconTab
              label="Calendar"
              selected={segment === 'calendar'}
              iosSymbol="calendar"
              androidSymbol="calendar_month"
              onPress={() => setSegment('calendar')}
            />
            <SegmentIconTab
              label="List"
              selected={segment === 'list'}
              iosSymbol="list.bullet"
              androidSymbol="format_list_bulleted"
              onPress={() => setSegment('list')}
            />
            <SegmentIconTab
              label="Past"
              selected={segment === 'past'}
              iosSymbol="receipt"
              androidSymbol="receipt_long"
              onPress={() => setSegment('past')}
            />
          </View>

          {segment !== 'past' && showTripSavings ? (
            <View style={styles.tripSavingsRow}>
              <SavingsChip
                compact={false}
                cents={tripSavingsCents}
                label={`Save ${formatSavingsCents(tripSavingsCents)} this trip`}
              />
              {activeReasons.includes('bestPrice') || activeReasons.includes('bestDeal') ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.tripSavingsHint}>
                  {activeReasons.includes('bestDeal')
                    ? 'Best deal day'
                    : (bestShopDay?.reasonLabel ?? 'Best price day')}
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <ThemedText type="small" style={{ color: theme.error }}>
              {error}
            </ThemedText>
          ) : null}
        </Animated.View>

        {segment !== 'past' && completedItemIds.size > 0 ? (
          <Animated.View
            entering={FadeInDown.duration(180)}
            style={[
              styles.completionStatus,
              { backgroundColor: theme.backgroundElement, borderColor: '#2E9E5B' },
            ]}>
            <SymbolView
              name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
              size={18}
              tintColor="#2E9E5B"
            />
            <ThemedText type="smallBold">
              {completedItemIds.size} item{completedItemIds.size === 1 ? '' : 's'} bought!
            </ThemedText>
          </Animated.View>
        ) : null}

        {segment === 'calendar' ? (
          <Animated.View entering={FadeInDown.delay(40).duration(280)} style={styles.section}>
            <WeekStrip days={weekDays} selectedYmd={activeYmd} onSelect={selectDay} />

            <Animated.View layout={drawerLayout}>
            <Animated.View
              key={activeYmd}
              entering={(slideDir === 'back' ? FadeInLeft : FadeInRight)
                .duration(320)
                .easing(Easing.out(Easing.cubic))}
              exiting={FadeOut.duration(140)}
              style={[styles.section, { overflow: 'hidden' }]}>
            <View style={styles.dayTitleRow}>
              <ThemedText type="smallBold" style={styles.dayTitle}>
                {activeYmd === todayYmd ? 'Today' : formatShortDate(activeYmd)}
              </ThemedText>
              {dayOrders.length > 0 ? (
                <Pressable
                  onPress={openDayFilters}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectedGroupFilters.size + selectedStoreFilters.size > 0
                      ? `Open filters, ${selectedGroupFilters.size + selectedStoreFilters.size} selected`
                      : 'Open filters'
                  }>
                  <SymbolView
                    name={{
                      ios: 'line.3.horizontal.decrease',
                      android: 'filter_list',
                      web: 'filter_list',
                    }}
                    size={22}
                    tintColor="#000000"
                  />
                </Pressable>
              ) : null}
            </View>

            {!isGroceryDay ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                No grocery run this day. Pick a highlighted day to see its orders.
              </ThemedText>
            ) : dayOrders.length > 0 ? (
              filteredDayOrders.length > 0 ? (
                dayOrderGroups.map(renderOrderGroup)
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                  No orders match these filters.
                </ThemedText>
              )
            ) : !hasAnyOpenItems && upcomingPlaced.length === 0 ? (
              emptyListBlock
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                No orders on this run.
              </ThemedText>
            )}

            {isGroceryDay && dayStaples.length > 0 ? (
              <Animated.View layout={drawerLayout} style={styles.section}>
                <SectionDivider label="Staples due" hint="Running low by this trip" />
                {dayStaples.map(({ habit, groupName }) => {
                  const name = habit.product_id
                    ? (productNames.get(habit.product_id) ?? 'Staple')
                    : 'Category staple';
                  return (
                    <ListItemRow
                      key={habit.id}
                      title={showSource ? `${name} · ${groupName}` : name}
                      imagePath={habit.product_id ? productImages.get(habit.product_id) : null}
                      cadenceTag={cadenceLabel(habit.interval_days)}
                      dueLabel={`Due ${formatShortDate(habit.next_due_on)}`}
                      onDone={() => router.push('/staples')}
                      onDelete={() => router.push('/staples')}
                    />
                  );
                })}
              </Animated.View>
            ) : null}

            {useSoon.length > 0 ? (
              <Animated.View layout={drawerLayout} style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold">Use soon</ThemedText>
                {useSoon.map((row) => (
                  <View
                    key={row.id}
                    style={[
                      styles.useSoonRow,
                      { borderColor: theme.borderInk, backgroundColor: theme.background },
                    ]}>
                    <ThemedText type="smallBold" style={{ flex: 1 }}>
                      Use by {formatShortDate(row.expires_on)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      qty {row.quantity}
                    </ThemedText>
                  </View>
                ))}
              </Animated.View>
            ) : null}
            </Animated.View>
            </Animated.View>
          </Animated.View>
        ) : segment === 'list' ? (
          <Animated.View entering={FadeInDown.delay(40).duration(280)} style={styles.section}>
            {upcomingDays.length === 0
              ? emptyListBlock
              : upcomingDays.map((ymd) => (
                  <Animated.View key={ymd} layout={drawerLayout} style={styles.section}>
                    <SectionDivider
                      label={ymd === todayYmd ? 'Today' : formatShortDate(ymd)}
                      hint={`${(ordersByDay.get(ymd) ?? []).length} order${(ordersByDay.get(ymd) ?? []).length === 1 ? '' : 's'}`}
                    />
                    {groupRunOrdersByStore(ordersByDay.get(ymd) ?? []).map(renderOrderGroup)}
                  </Animated.View>
                ))}
          </Animated.View>
        ) : (
          <View style={styles.section}>
            <ThemedText type="smallBold" style={styles.dayTitle}>
              Past orders
            </ThemedText>
            {pastOrders.length === 0 ? (
              <View style={styles.emptyBlock}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                  No orders placed yet.
                </ThemedText>
              </View>
            ) : (
              pastOrders.map((order) => (
                <Pressable
                  key={order.key}
                  onPress={() => void openPastDetail(order)}
                  style={[
                    styles.pastRow,
                    { backgroundColor: theme.background, borderColor: theme.borderInk },
                  ]}>
                  <StoreLogo storeName={order.storeName} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="smallBold">{order.storeName}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {[
                        showSource ? order.groupName : null,
                        formatShortDate(order.ymd),
                        `${order.itemCount} items`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                    <ThemedText
                      type="smallBold"
                      style={{ color: order.placed?.status === 'complete' ? '#2E9E5B' : theme.textSecondary }}>
                      {order.placed?.status === 'complete' ? 'Completed' : 'Placed'}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold">{formatMoney(order.totalCents)}</ThemedText>
                  {order.shopper ? (
                    <MemberAvatar
                      userId={order.shopper.userId}
                      name={order.shopper.name}
                      avatarUrl={order.shopper.avatarUrl}
                      size={26}
                      ringColor={theme.borderInk}
                    />
                  ) : null}
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={pastDetail != null}
        animationType="slide"
        transparent
        onRequestClose={() => setPastDetail(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPastDetail(null)} />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.borderInk,
                paddingBottom: insets.bottom + Spacing.three,
              },
            ]}>
            {pastDetail?.placed ? (
              <>
                <ThemedText type="smallBold" style={{ fontSize: Type.section }}>
                  {pastDetail.storeName}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {[
                    pastDetail.groupName,
                    formatShortDate(pastDetail.ymd),
                    formatMoney(pastDetail.totalCents),
                    pastDetail.placed.paid_by
                      ? `paid by ${memberName(pastDetail.groupId, pastDetail.placed.paid_by)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
                <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.one }}>
                  {pastItems.map((line) => {
                    const item = line.list_item_id ? itemById.get(line.list_item_id) : undefined;
                    return (
                      <View key={line.id} style={styles.stillRow}>
                        <ThemedText type="small" style={{ flex: 1 }}>
                          {item ? itemTitle(item) : 'Item'} · qty {line.quantity}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {formatMoney(Math.round(Number(line.quantity) * line.unit_price_cents))}
                        </ThemedText>
                      </View>
                    );
                  })}
                  {pastShares.length > 0 ? (
                    <View style={{ marginTop: Spacing.two, gap: Spacing.one }}>
                      <ThemedText type="smallBold">Splits</ThemedText>
                      {pastShares.map((share) => (
                        <ThemedText key={share.id} type="small" themeColor="textSecondary">
                          {memberName(pastDetail.groupId, share.user_id)} · {share.status} ·{' '}
                          {formatMoney(share.amount_cents)}
                        </ThemedText>
                      ))}
                    </View>
                  ) : null}
                </ScrollView>
                {pastDetail.placed.checkout_url ? (
                  <ButterButton
                    label="Open checkout"
                    variant="ink"
                    onPress={() => {
                      const url = pastDetail.placed?.checkout_url;
                      if (url) void Linking.openURL(url).catch(() => undefined);
                    }}
                  />
                ) : null}
                <ButterButton label="Close" variant="ghost" onPress={() => setPastDetail(null)} />
              </>
            ) : null}
          </View>
        </View>
      </Modal>
      {filtersOpen ? (
        <DayFiltersDrawer
          key={`day-filters-${activeYmd}`}
          visible
          groups={dayGroupFilters}
          locations={dayStoreFilters}
          selectedGroups={selectedGroupFilters}
          selectedLocations={selectedStoreFilters}
          onToggleGroup={(groupId) =>
            setSelectedGroupFilters((selected) => {
              const next = new Set(selected);
              if (next.has(groupId)) next.delete(groupId);
              else next.add(groupId);
              return next;
            })
          }
          onToggleLocation={(storeKey) =>
            setSelectedStoreFilters((selected) => {
              const next = new Set(selected);
              if (next.has(storeKey)) next.delete(storeKey);
              else next.add(storeKey);
              return next;
            })
          }
          onClear={() => {
            setSelectedGroupFilters(new Set());
            setSelectedStoreFilters(new Set());
          }}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
      <ShoppingCompleteOverlay origin={celebration} onContinue={() => setCelebration(null)} />
    </ThemedView>
  );
}

type SegmentIconTabProps = {
  label: string;
  selected: boolean;
  iosSymbol: string;
  androidSymbol: string;
  onPress: () => void;
};

function SegmentIconTab({ label, selected, iosSymbol, androidSymbol, onPress }: SegmentIconTabProps) {
  const theme = useTheme();
  const tint = selected ? theme.primary : theme.text;

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[
        styles.segmentTab,
        {
          backgroundColor: selected ? theme.secondary : theme.background,
          borderColor: theme.borderInk,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}>
      <SymbolView
        name={
          {
            ios: iosSymbol,
            android: androidSymbol,
            web: androidSymbol,
          } as React.ComponentProps<typeof SymbolView>['name']
        }
        size={18}
        tintColor={tint}
      />
      <ThemedText type="smallBold" style={{ color: tint, fontFamily: Fonts.sansBold }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  guestContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
  },
  titleRow: {
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: {
    fontSize: Type.pageTitle,
    lineHeight: 32,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segments: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tripSavingsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tripSavingsHint: {
    flexShrink: 1,
  },
  completionStatus: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.chip,
    borderWidth: 1.5,
  },
  segmentTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: 2,
  },
  section: {
    gap: Spacing.two,
  },
  edgeHitRight: {
    position: 'absolute',
    right: 0,
    width: 28,
    zIndex: 5,
  },
  storeGroup: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  storeGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  storeGroupTitle: {
    flex: 1,
    gap: 2,
  },
  storeGroupSection: {
    paddingTop: Spacing.two,
  },
  dayTitle: {
    fontSize: Type.section,
    lineHeight: 26,
  },
  dayTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyBlock: {
    gap: Spacing.two,
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  useSoonRow: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pastRow: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  guestCard: {
    gap: Spacing.two,
  },
  stillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalSheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderWidth: 2,
    borderBottomWidth: 0,
    padding: Spacing.three,
    gap: Spacing.two,
    maxHeight: '80%',
  },
});
