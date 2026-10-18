import type { Product, Promotion } from '../types';
import {
  applyFoodFilters,
  indexTraitsByProduct,
  rulesFromUserFoodRules,
} from './foodFilters';
import {
  formatPromotionBadge,
  getProductTraitsForIds,
  getProductsByIds,
  listCampusPopularProducts,
  listCurrentPromotions,
} from './catalog';
import { todayLocalDateKey, toLocalDateKey } from './localTime';
import { getDefaultGroceryList } from './lists';
import { suggestBestShopDate, suggestDiscountDate, type BestShopDay } from './planning';
import { listMyDiscountEligibilities, listMyFoodRules } from './profiles';
import { listHabits, listMyStapleProductIds } from './purchases';

const CAMPUS_TZ = 'America/Los_Angeles';

export type WeeklyBoardChip = {
  productId: string;
  name: string;
  brand: string | null;
  imagePath: string | null;
};

export type WeeklyBoardColumn = {
  id: 'today' | 'recommended' | 'bestDeal';
  title: string;
  dateLabel: string;
  headline: string;
  detail: string;
  timeWindowLabel: string | null;
  chips: WeeklyBoardChip[];
  /** Guest-only CTA on Best Deal when signed out */
  needsSignIn?: boolean;
};

export type WeeklyShoppingBoard = {
  foodPrefNote: string | null;
  columns: WeeklyBoardColumn[];
  recommended: BestShopDay | null;
};

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatShortDate(ymd: string): string {
  const day = parseYmd(ymd);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(day);
}

function weekdayOrdinal(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

function isLastWeekdayOfMonth(date: Date): boolean {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}

/** Client-side mirror of promotion_applies_on for a calendar YMD. */
export function promotionAppliesOnDate(promo: Promotion, ymd: string): boolean {
  const day = parseYmd(ymd);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const starts = new Date(promo.starts_at);
  const ends = new Date(promo.ends_at);
  if (!(starts < dayEnd && ends > dayStart)) return false;

  const dow = day.getDay();
  if (promo.weekdays && promo.weekdays.length > 0 && !promo.weekdays.includes(dow)) {
    return false;
  }
  if (promo.month_days && promo.month_days.length > 0 && !promo.month_days.includes(day.getDate())) {
    return false;
  }
  if (promo.month_ordinals && promo.month_ordinals.length > 0) {
    const ord = weekdayOrdinal(day);
    const ok =
      promo.month_ordinals.includes(ord) ||
      (promo.month_ordinals.includes(-1) && isLastWeekdayOfMonth(day));
    if (!ok) return false;
  }
  return true;
}

function localPartsOnDay(iso: string, ymd: string, timeZone: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const key = `${get('year')}-${get('month')}-${get('day')}`;
  return {
    onDay: key === ymd || toLocalDateKey(iso, timeZone) === ymd,
    hour: get('hour'),
    minute: get('minute'),
    dayPeriod: get('dayPeriod'),
    label: `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.trim(),
  };
}

/**
 * When a promo does not cover the full local calendar day, return a short window.
 */
export function promoTimeWindowLabel(promo: Promotion, ymd: string, timeZone = CAMPUS_TZ): string | null {
  const start = localPartsOnDay(promo.starts_at, ymd, timeZone);
  const end = localPartsOnDay(promo.ends_at, ymd, timeZone);
  const startKey = toLocalDateKey(promo.starts_at, timeZone);
  const endKey = toLocalDateKey(promo.ends_at, timeZone);

  // Spans full day or longer → no clock line.
  if (startKey < ymd && endKey > ymd) return null;
  if (startKey === ymd && endKey > ymd && start.label.startsWith('12:00 AM')) return null;
  if (startKey < ymd && endKey === ymd && (end.label.startsWith('11:59 PM') || end.label.startsWith('12:00 AM'))) {
    return null;
  }

  const startLabel = startKey === ymd ? start.label : '12:00 AM';
  const endLabel = endKey === ymd ? end.label : '11:59 PM';
  if (startLabel === '12:00 AM' && (endLabel === '11:59 PM' || endLabel === '12:00 AM')) {
    return null;
  }
  const dayShort = formatShortDate(ymd).split(',')[0] ?? formatShortDate(ymd);
  return `${dayShort} · ${startLabel}–${endLabel}`;
}

function eligiblePromos(
  promos: Promotion[],
  ymd: string,
  groupCodes: Set<string>,
): Promotion[] {
  return promos.filter((promo) => {
    if (!promotionAppliesOnDate(promo, ymd)) return false;
    if (promo.requires_group == null) return true;
    return groupCodes.has(promo.requires_group);
  });
}

function toChips(products: Product[]): WeeklyBoardChip[] {
  return products.slice(0, 4).map((product) => ({
    productId: product.id,
    name: product.name,
    brand: product.brand,
    imagePath: product.image_path,
  }));
}

async function filterProducts(
  products: Product[],
  rules: ReturnType<typeof rulesFromUserFoodRules>,
): Promise<Product[]> {
  if (products.length === 0) return [];
  const traits = await getProductTraitsForIds(products.map((row) => row.id));
  return applyFoodFilters(products, rules, indexTraitsByProduct(traits), {
    sort: 'default',
  });
}

/**
 * Three-column Weekly Shopping board for the Days tab.
 */
export async function getWeeklyShoppingBoard(input?: {
  postalCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  isGuest?: boolean;
}): Promise<WeeklyShoppingBoard> {
  const postalCode = input?.postalCode ?? '98195';
  const isGuest = Boolean(input?.isGuest);
  const today = todayLocalDateKey();

  const [recommended, allPromos] = await Promise.all([
    suggestBestShopDate({ postalCode }).catch(() => null),
    listCurrentPromotions().catch(() => [] as Promotion[]),
  ]);

  let groupCodes = new Set<string>();
  let rules = rulesFromUserFoodRules([]);
  let foodPrefNote: string | null = null;
  let discountDate: string | null = null;
  let stapleProducts: Product[] = [];
  let dueProducts: Product[] = [];

  if (!isGuest) {
    const [elig, foodRules, discount] = await Promise.all([
      listMyDiscountEligibilities().catch(() => []),
      listMyFoodRules().catch(() => []),
      suggestDiscountDate({
        latitude: input?.latitude ?? null,
        longitude: input?.longitude ?? null,
      }).catch(() => null),
    ]);
    groupCodes = new Set(elig.map((row) => row.group_code));
    rules = rulesFromUserFoodRules(foodRules);
    if (foodRules.length > 0) {
      foodPrefNote = 'Respecting your food preferences.';
    }
    discountDate = discount;

    try {
      const { group } = await getDefaultGroceryList();
      const [habits, stapleIds] = await Promise.all([
        listHabits(group.id),
        listMyStapleProductIds(group.id),
      ]);
      const dueIds = habits
        .filter((habit) => habit.product_id && habit.next_due_on <= today)
        .sort((a, b) => a.interval_days - b.interval_days)
        .map((habit) => habit.product_id as string);
      const freqIds = habits
        .filter((habit) => habit.product_id)
        .sort((a, b) => a.interval_days - b.interval_days)
        .map((habit) => habit.product_id as string);
      const orderedIds = [...new Set([...dueIds, ...freqIds, ...stapleIds])].slice(0, 12);
      const products = await getProductsByIds(orderedIds);
      const filtered = await filterProducts(products, rules);
      dueProducts = filtered.filter((p) => dueIds.includes(p.id));
      stapleProducts = filtered;
    } catch {
      // Guests / missing personal group — fall through to campus popular.
    }
  }

  if (stapleProducts.length < 2) {
    const popular = await listCampusPopularProducts({ limit: 12 }).catch(() => [] as Product[]);
    const filtered = await filterProducts(popular, rules);
    stapleProducts = [...stapleProducts, ...filtered].slice(0, 8);
  }

  const todayPromos = eligiblePromos(allPromos, today, groupCodes).filter(
    (p) => p.product_id == null || p.discount_type === 'percent_off',
  );
  const todayBasket = todayPromos.filter((p) => p.product_id == null);
  const todayHeadline =
    todayBasket.length > 0
      ? todayBasket
          .slice(0, 2)
          .map((p) => formatPromotionBadge(p))
          .join(' · ')
      : dueProducts.length > 0
        ? `${dueProducts.length} staple${dueProducts.length === 1 ? '' : 's'} due`
        : 'Stock up on frequent items';
  const todayDetail =
    todayBasket.length > 0
      ? 'Discounts you qualify for are active today.'
      : dueProducts.length > 0
        ? 'Based on how often you buy these staples.'
        : 'No staples due — shop your usuals when ready.';
  const todayWindow =
    todayBasket.map((p) => promoTimeWindowLabel(p, today)).find(Boolean) ?? null;

  const recDate = recommended?.shopOn ?? today;
  const recChips = await filterProducts(stapleProducts, rules);

  let bestDealColumn: WeeklyBoardColumn;
  if (isGuest) {
    bestDealColumn = {
      id: 'bestDeal',
      title: 'Best Deal Day',
      dateLabel: '—',
      headline: 'Sign in for deals',
      detail: 'See senior, student, and other discounts you qualify for.',
      timeWindowLabel: null,
      chips: toChips(recChips),
      needsSignIn: true,
    };
  } else {
    const dealYmd = discountDate ?? recDate;
    const dealPromos = eligiblePromos(allPromos, dealYmd, groupCodes).filter(
      (p) => p.product_id == null && p.discount_type === 'percent_off',
    );
    const top = dealPromos[0];
    const window =
      dealPromos.map((p) => promoTimeWindowLabel(p, dealYmd)).find(Boolean) ?? null;
    bestDealColumn = {
      id: 'bestDeal',
      title: 'Best Deal Day',
      dateLabel: formatShortDate(dealYmd),
      headline: top
        ? `${formatPromotionBadge(top)}${top.requires_group ? ` · ${top.requires_group}` : ''}`
        : groupCodes.size === 0
          ? 'Add discount eligibilities'
          : 'No qualifying deal soon',
      detail: top
        ? 'Largest basket discount in the next two months for groups you opted into.'
        : groupCodes.size === 0
          ? 'Turn on student, senior, or veteran discounts in your profile.'
          : 'No matching promotions near you right now.',
      timeWindowLabel: window,
      chips: toChips(recChips.slice().reverse()),
      needsSignIn: false,
    };
  }

  const columns: WeeklyBoardColumn[] = [
    {
      id: 'today',
      title: 'Shop Today',
      dateLabel: formatShortDate(today),
      headline: todayHeadline,
      detail: todayDetail,
      timeWindowLabel: todayWindow,
      chips: toChips(dueProducts.length > 0 ? dueProducts : stapleProducts),
    },
    {
      id: 'recommended',
      title: 'Recommended Shop Date',
      dateLabel: formatShortDate(recDate),
      headline: recommended?.reason === 'shelf_pattern' ? 'Lower shelf prices' : 'Best day to shop',
      detail: recommended?.reasonLabel ?? 'Based on nearby price history.',
      timeWindowLabel: null,
      chips: toChips(recChips),
    },
    bestDealColumn,
  ];

  return {
    foodPrefNote,
    columns,
    recommended,
  };
}
