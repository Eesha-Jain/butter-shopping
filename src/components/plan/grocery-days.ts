export type GroceryDayReason = 'preferred' | 'bestPrice' | 'bestDeal' | 'staples';

export type GroceryDayPlan = {
  /** Calendar window shown on the strip, starting today. */
  windowYmds: string[];
  /** Grocery run dates inside the window, ascending. */
  days: string[];
  reasons: Map<string, GroceryDayReason[]>;
  /** Default trip for items without a cadence (best price day, else first run). */
  primaryYmd: string;
};

/** A staple due this many days after the latest run still rides that run. */
const STAPLE_SLACK_DAYS = 3;

export function ymdFromLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  date.setDate(date.getDate() + days);
  return ymdFromLocalDate(date);
}

/**
 * Picks grocery run dates from preferred weekdays, the cheapest-price day, the
 * best discount day, and staple due dates that no other run already covers.
 */
export function buildGroceryDays(input: {
  todayYmd: string;
  windowDays?: number;
  preferredDays: readonly number[] | null | undefined;
  bestShopYmd: string | null;
  bestDealYmd: string | null;
  stapleDueYmds: readonly string[];
}): GroceryDayPlan {
  const windowDays = input.windowDays ?? 14;
  const windowYmds = Array.from({ length: windowDays }, (_, i) => addDays(input.todayYmd, i));
  const lastYmd = windowYmds[windowYmds.length - 1];
  const inWindow = (ymd: string | null): ymd is string =>
    Boolean(ymd) && (ymd as string) >= input.todayYmd && (ymd as string) <= lastYmd;

  const reasons = new Map<string, GroceryDayReason[]>();
  const add = (ymd: string, reason: GroceryDayReason) => {
    const bucket = reasons.get(ymd) ?? [];
    if (!bucket.includes(reason)) bucket.push(reason);
    reasons.set(ymd, bucket);
  };

  const preferred = new Set(input.preferredDays ?? []);
  if (preferred.size > 0) {
    for (const ymd of windowYmds) {
      if (preferred.has(parseYmd(ymd).getDay())) add(ymd, 'preferred');
    }
  }
  if (inWindow(input.bestShopYmd)) add(input.bestShopYmd, 'bestPrice');
  if (inWindow(input.bestDealYmd)) add(input.bestDealYmd, 'bestDeal');

  const dues = [...new Set(input.stapleDueYmds.map((ymd) => (ymd < input.todayYmd ? input.todayYmd : ymd)))]
    .filter((ymd) => ymd <= lastYmd)
    .sort();
  for (const due of dues) {
    const covered = [...reasons.keys()].some(
      (day) => day <= due && day >= addDays(due, -STAPLE_SLACK_DAYS),
    );
    if (!covered) add(due, 'staples');
  }

  if (reasons.size === 0) add(input.todayYmd, 'staples');

  const days = [...reasons.keys()].sort();
  const primaryYmd =
    input.bestShopYmd && reasons.has(input.bestShopYmd) ? input.bestShopYmd : days[0];

  return { windowYmds, days, reasons, primaryYmd };
}

/**
 * Staples go on the latest run on or before they are due (so you never run out);
 * everything else rides the primary run.
 */
export function assignGroceryDay(plan: GroceryDayPlan, dueYmd: string | null): string {
  if (!dueYmd) return plan.primaryYmd;
  let pick = plan.days[0];
  for (const day of plan.days) {
    if (day <= dueYmd) pick = day;
    else break;
  }
  return pick;
}

export function groceryDayBlurb(reasons: readonly GroceryDayReason[], bestShopLabel?: string | null): string {
  const bits: string[] = [];
  if (reasons.includes('bestPrice')) bits.push(bestShopLabel || 'Lowest prices this week.');
  if (reasons.includes('bestDeal')) bits.push('Best discount day for you.');
  if (reasons.includes('preferred')) bits.push('One of your usual grocery days.');
  if (reasons.includes('staples')) bits.push('Staples run out around now.');
  return bits.join(' ');
}
