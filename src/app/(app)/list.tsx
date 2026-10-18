import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveList } from '@/auth/active-list';
import { useGuestCart } from '@/auth/guest-cart-context';
import { useSession } from '@/auth/session';
import {
  getMyProfile,
  getProductsByIds,
  getStore,
  listExpiringPurchases,
  listGroupOrders,
  listHabits,
  listOrderItems,
  listOrderShares,
  listResolvedItems,
  placeStoreOrderFromList,
  planLowestTrip,
  recommendShoppingPlan,
  removeListItem,
  resolveShopZip,
  setListItemDone,
  showSuccessToast,
  suggestBestShopDate,
  suggestDiscountDate,
  todayLocalDateKey,
  type BestShopDay,
  type ExpiringPurchase,
  type GroupKind,
  type GroupOrderRow,
  type ItemHabit,
  type OrderItem,
  type OrderShare,
  type ResolvedListItem,
  type ShoppingPlanLine,
} from '@/backend';
import { GroupManageSheet } from '@/components/list/group-manage-sheet';
import {
  assignGroceryDay,
  buildGroceryDays,
  groceryDayBlurb,
  parseYmd,
  ymdFromLocalDate,
  type GroceryDayPlan,
} from '@/components/plan/grocery-days';
import { ListItemRow, cadenceLabel } from '@/components/plan/list-item-row';
import { SectionDivider } from '@/components/plan/section-divider';
import { StoreOrderCard, type StorePlanGroup } from '@/components/plan/store-order-card';
import { WeekStrip, type WeekDayCell } from '@/components/plan/week-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { NativeIconButton } from '@/components/ui/native-icon-button';
import { BottomTabInset, Fonts, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Segment = 'calendar' | 'list' | 'past';

function kindLabel(kind: GroupKind): string {
  if (kind === 'personal') return 'Personal';
  if (kind === 'household') return 'Household';
  return 'Party';
}

function formatShortDate(ymd: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseYmd(ymd));
}

function formatDayTitle(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return 'Today';
  const tomorrow = parseYmd(todayYmd);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (ymd === ymdFromLocalDate(tomorrow)) return 'Tomorrow';
  return formatShortDate(ymd);
}

function buildWeekCells(input: {
  todayYmd: string;
  plan: GroceryDayPlan;
  itemCountByDay: Map<string, number>;
}): WeekDayCell[] {
  return input.plan.windowYmds.map((ymd) => {
    const day = parseYmd(ymd);
    const reasons = input.plan.reasons.get(ymd) ?? [];
    return {
      ymd,
      weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day),
      dayNum: String(day.getDate()),
      isToday: ymd === input.todayYmd,
      isRecommended: reasons.includes('bestPrice'),
      hasHabitsDue: reasons.includes('staples'),
      isBestDeal: reasons.includes('bestDeal'),
      isGroceryDay: reasons.length > 0,
      itemCount: input.itemCountByDay.get(ymd) ?? 0,
    };
  });
}

function groupPlanByStore(
  lines: ShoppingPlanLine[],
  storeNames: Map<string, string>,
): StorePlanGroup[] {
  const byStore = new Map<string, ShoppingPlanLine[]>();
  for (const line of lines) {
    if (!line.store_id || line.store_product_id == null) continue;
    const bucket = byStore.get(line.store_id) ?? [];
    bucket.push(line);
    byStore.set(line.store_id, bucket);
  }
  return [...byStore.entries()]
    .map(([storeId, storeLines]) => ({
      storeId,
      storeName: storeNames.get(storeId) ?? 'Store',
      lines: storeLines,
      totalCents: storeLines.reduce((sum, row) => sum + (row.line_cents ?? 0), 0),
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
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

export default function PlanScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isGuest, requestSignIn } = useSession();
  const guestCart = useGuestCart();
  const {
    targets,
    activeTarget,
    setActiveTarget,
    refreshTargets,
    selectGroupId,
    isLoading: listsLoading,
  } = useActiveList();

  const [segment, setSegment] = useState<Segment>('calendar');
  const isPlanView = segment !== 'past';
  const [preferredDays, setPreferredDays] = useState<number[] | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [planning, setPlanning] = useState(false);

  const [listItems, setListItems] = useState<ResolvedListItem[]>([]);
  const [habits, setHabits] = useState<ItemHabit[]>([]);
  const [expiring, setExpiring] = useState<ExpiringPurchase[]>([]);
  const [productImages, setProductImages] = useState<Map<string, string | null>>(() => new Map());
  const [productNames, setProductNames] = useState<Map<string, string>>(() => new Map());
  const [bestShopDay, setBestShopDay] = useState<BestShopDay | null>(null);
  const [bestDealYmd, setBestDealYmd] = useState<string | null>(null);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [planLines, setPlanLines] = useState<ShoppingPlanLine[]>([]);
  const [storeNames, setStoreNames] = useState<Map<string, string>>(() => new Map());
  const [buyHereOpen, setBuyHereOpen] = useState(false);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);
  const [orderingStoreId, setOrderingStoreId] = useState<string | null>(null);

  const [pastOrders, setPastOrders] = useState<GroupOrderRow[]>([]);
  const [pastDetail, setPastDetail] = useState<GroupOrderRow | null>(null);
  const [pastItems, setPastItems] = useState<OrderItem[]>([]);
  const [pastShares, setPastShares] = useState<OrderShare[]>([]);
  const [pastLoading, setPastLoading] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const listId = activeTarget?.list.id ?? null;
  const groupId = activeTarget?.group.id ?? null;
  const todayYmd = todayLocalDateKey();

  const habitByItemKey = useMemo(() => {
    const map = new Map<string, ItemHabit>();
    for (const habit of habits) {
      const key = habitKey(habit);
      if (key && !map.has(key)) map.set(key, habit);
    }
    return map;
  }, [habits]);

  const itemDueYmd = useCallback(
    (item: ResolvedListItem): string | null => {
      const key = itemHabitKey(item);
      return (key ? habitByItemKey.get(key)?.next_due_on : null) ?? null;
    },
    [habitByItemKey],
  );

  /** Staples with auto-add on that are not already on the list. */
  const upcomingStaples = useMemo(() => {
    const onList = new Set(listItems.map(itemHabitKey).filter(Boolean));
    return habits.filter((habit) => {
      const key = habitKey(habit);
      return habit.auto_add_enabled && habit.next_due_on && key && !onList.has(key);
    });
  }, [habits, listItems]);

  const groceryPlan = useMemo(
    () =>
      buildGroceryDays({
        todayYmd,
        preferredDays,
        bestShopYmd: bestShopDay?.shopOn ?? null,
        bestDealYmd,
        stapleDueYmds: [
          ...listItems.filter((item) => !item.done_at).map(itemDueYmd),
          ...upcomingStaples.map((habit) => habit.next_due_on),
        ].filter((ymd): ymd is string => Boolean(ymd)),
      }),
    [todayYmd, preferredDays, bestShopDay?.shopOn, bestDealYmd, listItems, upcomingStaples, itemDueYmd],
  );

  const dayByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of listItems) {
      map.set(item.id, assignGroceryDay(groceryPlan, itemDueYmd(item)));
    }
    return map;
  }, [listItems, groceryPlan, itemDueYmd]);

  const activeYmd =
    selectedYmd && groceryPlan.windowYmds.includes(selectedYmd)
      ? selectedYmd
      : groceryPlan.primaryYmd;
  const activeReasons = groceryPlan.reasons.get(activeYmd) ?? [];
  const isGroceryDay = activeReasons.length > 0;

  const selectedYmdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedYmdRef.current = activeYmd;
  }, [activeYmd]);

  const openItems = useMemo(
    () => listItems.filter((item) => !item.done_at),
    [listItems],
  );

  const doneItems = useMemo(
    () => listItems.filter((item) => item.done_at),
    [listItems],
  );

  const orderedItems = useMemo(() => [...openItems, ...doneItems], [openItems, doneItems]);

  const dayItems = useMemo(
    () => orderedItems.filter((item) => dayByItemId.get(item.id) === activeYmd),
    [orderedItems, dayByItemId, activeYmd],
  );

  const dayOpenItemIds = useMemo(
    () => new Set(dayItems.filter((item) => !item.done_at).map((item) => item.id)),
    [dayItems],
  );

  const itemCountByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of openItems) {
      const ymd = dayByItemId.get(item.id);
      if (ymd) counts.set(ymd, (counts.get(ymd) ?? 0) + 1);
    }
    return counts;
  }, [openItems, dayByItemId]);

  const weekDays = useMemo(
    () => buildWeekCells({ todayYmd, plan: groceryPlan, itemCountByDay }),
    [todayYmd, groceryPlan, itemCountByDay],
  );

  const storeGroups = useMemo(
    () =>
      groupPlanByStore(
        planLines.filter((line) => dayOpenItemIds.has(line.list_item_id)),
        storeNames,
      ),
    [planLines, storeNames, dayOpenItemIds],
  );

  const dayStaples = useMemo(
    () =>
      upcomingStaples
        .filter((habit) => assignGroceryDay(groceryPlan, habit.next_due_on) === activeYmd)
        .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on)),
    [upcomingStaples, groceryPlan, activeYmd],
  );

  const nextGroceryYmd = useMemo(
    () => groceryPlan.days.find((ymd) => ymd > activeYmd) ?? null,
    [groceryPlan, activeYmd],
  );

  const useSoon = useMemo(
    () =>
      expiring
        .filter((row) => row.expires_on >= activeYmd)
        .sort((a, b) => a.expires_on.localeCompare(b.expires_on))
        .slice(0, 8),
    [expiring, activeYmd],
  );

  const tripEstimateCents = useMemo(
    () => storeGroups.reduce((sum, group) => sum + group.totalCents, 0),
    [storeGroups],
  );

  const imageByListItemId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const item of listItems) {
      if (item.product_id) {
        map.set(item.id, productImages.get(item.product_id) ?? null);
      }
    }
    return map;
  }, [listItems, productImages]);

  const dayBlurb = useMemo(() => {
    if (!isGroceryDay) {
      return nextGroceryYmd
        ? `No grocery run planned. Next run: ${formatDayTitle(nextGroceryYmd, todayYmd)}.`
        : 'No grocery run planned for this day.';
    }
    const why = groceryDayBlurb(activeReasons, bestShopDay?.reasonLabel);
    return why || `Your haul for ${formatShortDate(activeYmd)}.`;
  }, [isGroceryDay, nextGroceryYmd, todayYmd, activeReasons, bestShopDay?.reasonLabel, activeYmd]);

  const loadProductImages = useCallback(async (items: ResolvedListItem[], habitRows: ItemHabit[]) => {
    const ids = [
      ...new Set(
        [
          ...items.map((item) => item.product_id),
          ...habitRows.map((habit) => habit.product_id),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length === 0) {
      setProductImages(new Map());
      setProductNames(new Map());
      return;
    }
    try {
      const products = await getProductsByIds(ids);
      const images = new Map<string, string | null>();
      const names = new Map<string, string>();
      for (const product of products) {
        images.set(product.id, product.image_path);
        names.set(product.id, product.name);
      }
      setProductImages(images);
      setProductNames(names);
    } catch {
      setProductImages(new Map());
      setProductNames(new Map());
    }
  }, []);

  const loadPlanForDay = useCallback(
    async (targetListId: string, plannedFor: string, zip: string, deep = false) => {
      setPlanning(true);
      try {
        const lines = deep
          ? await planLowestTrip({ listId: targetListId, plannedFor, zip })
          : await recommendShoppingPlan({ listId: targetListId, plannedFor }).catch(() =>
              planLowestTrip({ listId: targetListId, plannedFor, zip }),
            );
        setPlanLines(lines);
        const ids = [...new Set(lines.map((line) => line.store_id).filter(Boolean))] as string[];
        const names = new Map<string, string>();
        await Promise.all(
          ids.map(async (id) => {
            try {
              const store = await getStore(id);
              names.set(id, store.name);
            } catch {
              names.set(id, 'Store');
            }
          }),
        );
        setStoreNames(names);
      } catch {
        setPlanLines([]);
        setStoreNames(new Map());
      } finally {
        setPlanning(false);
      }
    },
    [],
  );

  const loadPlan = useCallback(
    async (refresh = false) => {
      if (isGuest) {
        setIsLoading(false);
        setIsRefreshing(false);
        setError(null);
        return;
      }
      if (!listId || !groupId) {
        if (!listsLoading) {
          setIsLoading(false);
          setListItems([]);
        }
        return;
      }
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const zip = await resolveShopZip().catch(() => '98195');
        const [rows, habitRows, shopDay, discount, expiringRows, profile] = await Promise.all([
          listResolvedItems(listId),
          listHabits(groupId),
          suggestBestShopDate({ postalCode: zip, listId }).catch(() => null),
          suggestDiscountDate().catch(() => null),
          listExpiringPurchases(groupId).catch(() => [] as ExpiringPurchase[]),
          getMyProfile().catch(() => null),
        ]);
        setListItems(rows);
        setHabits(habitRows);
        setExpiring(expiringRows);
        setBestShopDay(shopDay);
        setBestDealYmd(discount);
        setPreferredDays(profile?.preferred_days ?? null);
        void loadProductImages(rows, habitRows);
        if (refresh) {
          const plannedFor = selectedYmdRef.current ?? shopDay?.shopOn ?? todayYmd;
          await loadPlanForDay(listId, plannedFor, zip, true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your plan.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isGuest, listId, groupId, listsLoading, todayYmd, loadPlanForDay, loadProductImages],
  );

  const loadPast = useCallback(async () => {
    if (isGuest || !groupId) {
      setPastOrders([]);
      return;
    }
    setPastLoading(true);
    try {
      setPastOrders(await listGroupOrders(groupId, { status: 'ordered' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load past orders.');
      setPastOrders([]);
    } finally {
      setPastLoading(false);
    }
  }, [isGuest, groupId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (segment === 'past') void loadPast();
      else void loadPlan();
    }, 0);
    return () => clearTimeout(timer);
  }, [segment, loadPlan, loadPast]);

  useEffect(() => {
    if (isGuest || !listId || segment !== 'calendar' || !isGroceryDay) return;
    const timer = setTimeout(() => {
      void (async () => {
        const zip = await resolveShopZip().catch(() => '98195');
        await loadPlanForDay(listId, activeYmd, zip, false);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [activeYmd, isGroceryDay, listId, isGuest, segment, loadPlanForDay]);

  const onGroupChanged = async (nextGroupId?: string) => {
    if (nextGroupId) await selectGroupId(nextGroupId);
    else await refreshTargets();
  };

  const onOrderStore = async (storeId: string) => {
    if (!listId || !groupId || !isGroceryDay || orderingStoreId) return;
    setOrderingStoreId(storeId);
    setError(null);
    try {
      const result = await placeStoreOrderFromList({
        listId,
        groupId,
        plannedFor: activeYmd,
        storeId,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showSuccessToast('Order placed', 'It will show under Past.');
      if (result.checkoutUrl) {
        void Linking.openURL(result.checkoutUrl).catch(() => undefined);
      }
      await loadPlan(true);
      await loadPast();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place that order.');
    } finally {
      setOrderingStoreId(null);
    }
  };

  const openPastDetail = async (order: GroupOrderRow) => {
    setPastDetail(order);
    setPastItems([]);
    setPastShares([]);
    try {
      const [items, shares] = await Promise.all([
        listOrderItems(order.order_id),
        listOrderShares(order.order_id).catch(() => [] as OrderShare[]),
      ]);
      setPastItems(items);
      setPastShares(shares);
    } catch {
      setPastItems([]);
    }
  };

  const scrollToBuyHere = () => {
    setBuyHereOpen(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };

  const stickyVisible =
    segment === 'calendar' && !isGuest && isGroceryDay && dayOpenItemIds.size > 0;
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

  if ((isLoading || listsLoading) && isPlanView && listItems.length === 0 && !error) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.secondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Loading your plan
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing.one,
            paddingBottom: tabBarClearance + Spacing.four + (stickyVisible ? 72 : 0),
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing || (segment === 'past' && pastLoading)}
            onRefresh={() => {
              if (isPlanView) void loadPlan(true);
              else void loadPast();
            }}
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
                iosSymbol="text.book.closed.fill"
                androidSymbol="menu_book"
                onPress={() => router.push('/recipe-import')}
              />
              <NativeIconButton
                accessibilityLabel="Staples"
                iosSymbol="carrot.fill"
                androidSymbol="nutrition"
                onPress={() => router.push('/staples')}
              />
              <NativeIconButton
                accessibilityLabel="Manage groups"
                iosSymbol="person.2.fill"
                androidSymbol="group"
                onPress={() => setManageOpen(true)}
              />
            </View>
          </View>

          {activeTarget ? (
            <ThemedText type="small" themeColor="textSecondary">
              {activeTarget.group.name} · {kindLabel(activeTarget.group.kind)}
            </ThemedText>
          ) : null}

          {targets.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}>
              {targets.map((target) => (
                <ButterChip
                  key={target.list.id}
                  label={target.group.name}
                  selected={activeTarget?.list.id === target.list.id}
                  onPress={() => setActiveTarget(target)}
                />
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.segments}>
            <SegmentIconTab
              label="Plan"
              selected={segment === 'plan'}
              iosSymbol="calendar"
              androidSymbol="calendar_month"
              onPress={() => setSegment('plan')}
            />
            <SegmentIconTab
              label="Past"
              selected={segment === 'past'}
              iosSymbol="receipt"
              androidSymbol="receipt_long"
              onPress={() => setSegment('past')}
            />
          </View>

          {error ? (
            <ThemedText type="small" style={{ color: theme.error }}>
              {error}
            </ThemedText>
          ) : null}
        </Animated.View>

        {segment === 'plan' ? (
          <Animated.View entering={FadeInDown.delay(40).duration(280)} style={styles.section}>
            <WeekStrip
              days={weekDays}
              selectedYmd={selectedYmd}
              onSelect={(ymd) => {
                setSelectedYmd(ymd);
                setBuyHereOpen(false);
              }}
            />

            {selectedYmd ? (
              <View
                style={[
                  styles.dayBubble,
                  { backgroundColor: theme.background, borderColor: theme.borderInk },
                ]}>
                <ThemedText type="smallBold" style={styles.dayTitle}>
                  {formatDayTitle(selectedYmd, todayYmd)}
                </ThemedText>
                {dayBlurb ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {dayBlurb}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            {listItems.length === 0 ? (
              <View style={styles.emptyBlock}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                  Nothing on this trip yet. Add picks from Shop, then come back to plan.
                </ThemedText>
                <ButterButton label="Browse shop" variant="yellow" onPress={() => router.push('/')} />
                <ButterButton
                  label="Import recipe"
                  variant="ghost"
                  onPress={() => router.push('/recipe-import')}
                />
              </View>
            ) : (
              orderedItems.map((item) => {
                const title = item.display_name?.trim() || item.custom_name?.trim() || 'Item';
                const key = itemHabitKey(item);
                const habit = key ? habitByItemKey.get(key) : undefined;
                const isDone = Boolean(item.done_at);
                return (
                  <ListItemRow
                    key={item.id}
                    title={title}
                    quantity={Number(item.quantity) || undefined}
                    priceCents={item.best_price_cents}
                    imagePath={item.product_id ? productImages.get(item.product_id) : null}
                    cadenceTag={habit ? cadenceLabel(habit.interval_days) : null}
                    recipeTag={Boolean(item.source_recipe_id)}
                    done={isDone}
                    onDone={() => {
                      const next = !isDone;
                      setListItems((rows) =>
                        rows.map((row) =>
                          row.id === item.id
                            ? { ...row, done_at: next ? new Date().toISOString() : null }
                            : row,
                        ),
                      );
                      void setListItemDone(item.id, next).then(() => loadPlan(true));
                    }}
                    onDelete={() => {
                      setListItems((rows) => rows.filter((row) => row.id !== item.id));
                      void removeListItem(item.id).then(() => loadPlan(true));
                    }}
                  />
                );
              })
            )}

            {futureHabits.length > 0 || useSoon.length > 0 ? (
              <>
                <SectionDivider
                  label="Future"
                  hint="Later staples and food to use soon"
                />
                {futureHabits.map((habit) => {
                  const name = habit.product_id
                    ? productNames.get(habit.product_id) ?? 'Staple'
                    : 'Category staple';
                  return (
                    <ListItemRow
                      key={habit.id}
                      title={name}
                      imagePath={habit.product_id ? productImages.get(habit.product_id) : null}
                      cadenceTag={cadenceLabel(habit.interval_days)}
                      dueLabel={`Due ${formatShortDate(habit.next_due_on)}`}
                      onDone={() => router.push('/staples')}
                      onDelete={() => router.push('/staples')}
                    />
                  );
                })}
                {useSoon.length > 0 ? (
                  <View style={{ gap: Spacing.one }}>
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
                  </View>
                ) : null}
              </>
            ) : null}

            <SectionDivider
              label="Buy here"
              hint={
                storeGroups.length > 0
                  ? `${storeGroups.length} store${storeGroups.length === 1 ? '' : 's'} · ~${formatMoney(tripEstimateCents)}`
                  : planning
                    ? 'Pricing this day’s trip…'
                    : 'Store split for this day'
              }
            />

            <Pressable
              onPress={() => setBuyHereOpen((value) => !value)}
              style={[
                styles.buyHereSummary,
                { backgroundColor: theme.background, borderColor: theme.borderInk },
              ]}
              accessibilityRole="button">
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="smallBold">
                  {storeGroups.length > 0
                    ? `${storeGroups.length} store${storeGroups.length === 1 ? '' : 's'} · ~${formatMoney(tripEstimateCents)}`
                    : planning
                      ? 'Finding stores…'
                      : 'No store split yet'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {buyHereOpen ? 'Hide store orders' : 'Show store orders'}
                </ThemedText>
              </View>
              {planning ? <ActivityIndicator color={theme.secondary} /> : null}
            </Pressable>

            {buyHereOpen ? (
              storeGroups.length === 0 && !planning ? (
                <View style={styles.emptyBlock}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                    {openItems.length > 0
                      ? 'No priced store split yet for this day. Pull to refresh or add products from Shop.'
                      : 'Add items from Shop, then come back to order by store.'}
                  </ThemedText>
                </View>
              ) : (
                storeGroups.map((group) => (
                  <StoreOrderCard
                    key={group.storeId}
                    group={group}
                    expanded={expandedStoreId === group.storeId}
                    ordering={orderingStoreId === group.storeId}
                    imageByListItemId={imageByListItemId}
                    onToggle={() =>
                      setExpandedStoreId((current) =>
                        current === group.storeId ? null : group.storeId,
                      )
                    }
                    onOrder={() => void onOrderStore(group.storeId)}
                  />
                ))
              )
            ) : null}
          </Animated.View>
        ) : (
          <View style={styles.section}>
            <ThemedText type="smallBold" style={styles.dayTitle}>
              Past orders
            </ThemedText>
            {pastLoading ? (
              <ActivityIndicator color={theme.secondary} />
            ) : pastOrders.length === 0 ? (
              <View style={styles.emptyBlock}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                  No placed orders yet. Order a store trip from Plan.
                </ThemedText>
              </View>
            ) : (
              pastOrders.map((order) => (
                <Pressable
                  key={order.order_id}
                  onPress={() => void openPastDetail(order)}
                  style={[
                    styles.pastRow,
                    { backgroundColor: theme.background, borderColor: theme.borderInk },
                  ]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="smallBold">{order.store_name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatShortDate(order.planned_for)} · {order.item_count} items
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold">{formatMoney(order.total_cents)}</ThemedText>
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {stickyVisible ? (
        <View
          style={[
            styles.stickyBar,
            {
              backgroundColor: theme.background,
              borderTopColor: theme.border,
            },
          ]}>
          <ButterButton
            label={
              tripEstimateCents > 0
                ? `Shop this day · ~${formatMoney(tripEstimateCents)}`
                : 'Shop this day'
            }
            variant="ink"
            onPress={scrollToBuyHere}
            style={styles.stickyBtn}
          />
        </View>
      ) : null}

      <GroupManageSheet
        visible={manageOpen}
        activeTarget={activeTarget}
        onClose={() => setManageOpen(false)}
        onGroupChanged={onGroupChanged}
      />

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
            {pastDetail ? (
              <>
                <ThemedText type="smallBold" style={{ fontSize: Type.section }}>
                  {pastDetail.store_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatShortDate(pastDetail.planned_for)} · {formatMoney(pastDetail.total_cents)}
                </ThemedText>
                <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.one }}>
                  {pastItems.map((item) => (
                    <View key={item.id} style={styles.stillRow}>
                      <ThemedText type="small" style={{ flex: 1 }}>
                        Line · qty {item.quantity}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatMoney(Math.round(Number(item.quantity) * item.unit_price_cents))}
                      </ThemedText>
                    </View>
                  ))}
                  {pastShares.length > 0 ? (
                    <View style={{ marginTop: Spacing.two, gap: Spacing.one }}>
                      <ThemedText type="smallBold">Splits</ThemedText>
                      {pastShares.map((share) => (
                        <ThemedText key={share.id} type="small" themeColor="textSecondary">
                          {share.status}: {formatMoney(share.amount_cents)}
                        </ThemedText>
                      ))}
                    </View>
                  ) : null}
                </ScrollView>
                <ButterButton label="Close" variant="ghost" onPress={() => setPastDetail(null)} />
              </>
            ) : null}
          </View>
        </View>
      </Modal>
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

function SegmentIconTab({
  label,
  selected,
  iosSymbol,
  androidSymbol,
  onPress,
}: SegmentIconTabProps) {
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
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  segments: {
    flexDirection: 'row',
    gap: Spacing.two,
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
  dayBubble: {
    borderWidth: 3,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  dayTitle: {
    fontSize: Type.section,
    lineHeight: 26,
  },
  emptyBlock: {
    gap: Spacing.two,
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  collapseCard: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  collapseHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  buyHereSummary: {
    borderWidth: 3,
    borderRadius: Radius.card,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BottomTabInset,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stickyBtn: {
    minHeight: 52,
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
