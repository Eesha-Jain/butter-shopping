import * as Location from 'expo-location';
import { AppState, type AppStateStatus } from 'react-native';

import {
  fetchVisaMerchantOffers,
  getEffectiveGroceryCashbackBps,
  getProductTraitsForIds,
  listFoodTraits,
  listProductStoreOffers,
  refreshProductStoreOffers,
  resolveShopZip,
  type Product,
  type ProductStoreOffer,
  type SessionFoodRule,
  type VisaMerchantOffer,
} from '@/backend';
import type { FoodTrait, ProductTrait } from '@/backend/types';

/**
 * Warms the product popup's data (store offers, cash back, traits) in the background so the
 * peek opens with prices already on screen. Work runs through a small priority queue:
 * trending → preferred (favorites, staples, on-list, preference matches) → everything else.
 */

export type ProductDetailCacheEntry = {
  offers: ProductStoreOffer[];
  visaOffers: VisaMerchantOffer[];
  cashbackBps: number | null;
  /** Last live retailer check (0 = only persisted offers loaded). */
  refreshedAt: number;
  /** Last time persisted offers were read. */
  loadedAt: number;
};

export const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

const PRIORITY = { trending: 0, preferred: 1, normal: 2 } as const;
type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

const CONCURRENCY = 2;
const MAX_CACHE_ENTRIES = 300;
const MAX_NORMAL_PER_SCHEDULE = 40;
/** Live retailer checks hit the scraping proxy, so cap them per app session. */
const MAX_LIVE_REFRESHES = 24;
const TRAIT_BATCH = 50;

const detailCache = new Map<string, ProductDetailCacheEntry>();
const traitCache = new Map<string, ProductTrait[]>();
const inflight = new Map<string, Promise<ProductDetailCacheEntry>>();
let foodTraitsPromise: Promise<FoodTrait[]> | null = null;
let foodTraitsValue: FoodTrait[] | null = null;

export function getCachedProductDetail(productId: string): ProductDetailCacheEntry | undefined {
  return detailCache.get(productId);
}

export function setCachedProductDetail(
  productId: string,
  patch: Partial<ProductDetailCacheEntry>,
): ProductDetailCacheEntry {
  const prev = detailCache.get(productId);
  const next: ProductDetailCacheEntry = {
    offers: patch.offers ?? prev?.offers ?? [],
    visaOffers: patch.visaOffers ?? prev?.visaOffers ?? [],
    cashbackBps: patch.cashbackBps !== undefined ? patch.cashbackBps : (prev?.cashbackBps ?? null),
    refreshedAt: patch.refreshedAt ?? prev?.refreshedAt ?? 0,
    loadedAt: patch.loadedAt ?? prev?.loadedAt ?? 0,
  };
  // Re-insert so Map order doubles as LRU order.
  detailCache.delete(productId);
  detailCache.set(productId, next);
  while (detailCache.size > MAX_CACHE_ENTRIES) {
    const oldest = detailCache.keys().next().value;
    if (oldest === undefined) break;
    detailCache.delete(oldest);
  }
  return next;
}

/** Stores freshly read offers; `live` marks them as coming from a retailer check. */
export function markProductOffersLoaded(
  productId: string,
  offers: ProductStoreOffer[],
  opts: { live?: boolean } = {},
): ProductDetailCacheEntry {
  const now = Date.now();
  return setCachedProductDetail(productId, {
    offers,
    loadedAt: now,
    ...(opts.live ? { refreshedAt: now } : {}),
  });
}

export function isDetailLive(entry: ProductDetailCacheEntry | undefined): boolean {
  return entry != null && Date.now() - entry.refreshedAt <= DETAIL_CACHE_TTL_MS;
}

function isDetailLoaded(entry: ProductDetailCacheEntry | undefined): boolean {
  return entry != null && Date.now() - entry.loadedAt <= DETAIL_CACHE_TTL_MS;
}

/** Loads persisted offers + cash back context; concurrent callers share one request. */
export function loadProductDetail(
  productId: string,
  isGuest: boolean,
): Promise<ProductDetailCacheEntry> {
  const pending = inflight.get(productId);
  if (pending) return pending;
  const promise = Promise.all([
    listProductStoreOffers(productId),
    fetchVisaMerchantOffers(),
    getEffectiveGroceryCashbackBps(isGuest),
  ])
    .then(([offers, visa, cashbackBps]) =>
      setCachedProductDetail(productId, {
        offers,
        visaOffers: visa.offers,
        cashbackBps,
        loadedAt: Date.now(),
      }),
    )
    .finally(() => {
      inflight.delete(productId);
    });
  inflight.set(productId, promise);
  return promise;
}

export function getCachedProductTraits(productId: string): ProductTrait[] | undefined {
  return traitCache.get(productId);
}

export function getCachedFoodTraits(): FoodTrait[] | null {
  return foodTraitsValue;
}

export function loadFoodTraits(): Promise<FoodTrait[]> {
  if (!foodTraitsPromise) {
    foodTraitsPromise = listFoodTraits()
      .then((rows) => {
        foodTraitsValue = rows;
        return rows;
      })
      .catch((err) => {
        foodTraitsPromise = null;
        throw err;
      });
  }
  return foodTraitsPromise;
}

export async function loadProductTraits(productIds: string[]): Promise<void> {
  const missing = [...new Set(productIds)].filter((id) => id && !traitCache.has(id));
  for (let i = 0; i < missing.length; i += TRAIT_BATCH) {
    const ids = missing.slice(i, i + TRAIT_BATCH);
    const rows = await getProductTraitsForIds(ids);
    for (const id of ids) traitCache.set(id, []);
    for (const row of rows) traitCache.get(row.product_id)?.push(row);
  }
}

export function productMatchesPreferences(
  productId: string,
  rules: SessionFoodRule[],
): boolean {
  const traits = traitCache.get(productId);
  if (!traits || traits.length === 0) return false;
  return rules.some(
    (rule) =>
      (rule.mode === 'prefer' || rule.mode === 'require') &&
      traits.some(
        (trait) =>
          trait.trait_id === rule.trait_id &&
          (trait.relation === 'suitable' || trait.relation === 'certified'),
      ),
  );
}

// ---------------------------------------------------------------------------
// Background queue
// ---------------------------------------------------------------------------

type QueueItem = { product: Product; priority: Priority };

export type ProductPrefetchRequest = {
  trending: Product[];
  /** Favorites, staples, items on the list — always treated as preferred. */
  preferred: Product[];
  normal: Product[];
  /** Products whose traits match these prefer/require rules are promoted to preferred. */
  preferenceRules?: SessionFoodRule[];
  isGuest: boolean;
  /** Known ZIP for live store checks; otherwise only used if location is already granted. */
  zip?: string | null;
};

const buckets: QueueItem[][] = [[], [], []];
const queuedIds = new Set<string>();
let activeWorkers = 0;
let paused = false;
let appActive = AppState.currentState !== 'background';
let appStateSub: { remove: () => void } | null = null;
let resumeWaiters: (() => void)[] = [];
let generation = 0;
let liveRefreshesUsed = 0;
let currentIsGuest = true;
let currentZip: string | null = null;
let zipLookup: Promise<string | null> | null = null;

function canRun(): boolean {
  return !paused && appActive;
}

function notifyResume() {
  if (!canRun()) return;
  const waiters = resumeWaiters;
  resumeWaiters = [];
  for (const resolve of waiters) resolve();
  pump();
}

function waitUntilRunnable(): Promise<void> {
  if (canRun()) return Promise.resolve();
  return new Promise((resolve) => resumeWaiters.push(resolve));
}

type IdleCallback = (cb: () => void, opts?: { timeout: number }) => unknown;

/** Yields to rendering/gestures so prefetch never competes with scrolling or animations. */
function waitForIdle(): Promise<void> {
  const ric = (globalThis as { requestIdleCallback?: IdleCallback }).requestIdleCallback;
  return new Promise((resolve) => {
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 750 });
    else setTimeout(resolve, 50);
  });
}

function ensureAppStateListener() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    appActive = state !== 'background';
    notifyResume();
  });
}

/** Pauses background prefetch (e.g. while a popup is fetching its own data). */
export function setProductPrefetchPaused(next: boolean) {
  paused = next;
  notifyResume();
}

async function resolvePrefetchZip(): Promise<string | null> {
  if (currentZip) return currentZip;
  if (!zipLookup) {
    zipLookup = (async () => {
      try {
        // Never prompt from the background — only reuse an existing grant or saved location.
        const { granted } = await Location.getForegroundPermissionsAsync();
        if (!granted) return null;
        const zip = await resolveShopZip();
        return zip || null;
      } catch {
        return null;
      }
    })();
  }
  return zipLookup;
}

function takeNext(): QueueItem | null {
  for (const bucket of buckets) {
    const item = bucket.shift();
    if (item) {
      queuedIds.delete(item.product.id);
      return item;
    }
  }
  return null;
}

async function runItem(item: QueueItem, gen: number) {
  const { product, priority } = item;
  let entry = detailCache.get(product.id);
  if (!isDetailLoaded(entry)) {
    entry = await loadProductDetail(product.id, currentIsGuest);
  }
  if (gen !== generation) return;
  if (priority === PRIORITY.normal || isDetailLive(entry) || liveRefreshesUsed >= MAX_LIVE_REFRESHES) {
    return;
  }
  const zip = await resolvePrefetchZip();
  if (!zip || gen !== generation) return;
  liveRefreshesUsed += 1;
  const offers = await refreshProductStoreOffers(product, zip);
  markProductOffersLoaded(product.id, offers, { live: true });
}

function pump() {
  while (activeWorkers < CONCURRENCY && canRun() && buckets.some((b) => b.length > 0)) {
    activeWorkers += 1;
    void (async () => {
      try {
        for (;;) {
          await waitUntilRunnable();
          await waitForIdle();
          if (!canRun()) continue;
          const item = takeNext();
          if (!item) break;
          try {
            await runItem(item, generation);
          } catch {
            // Best effort — the popup fetches on open if prefetch failed.
          }
        }
      } finally {
        activeWorkers -= 1;
      }
    })();
  }
}

function enqueue(products: Product[], priority: Priority, limit = Infinity) {
  let added = 0;
  for (const product of products) {
    if (added >= limit) break;
    if (!product?.id || queuedIds.has(product.id)) continue;
    const entry = detailCache.get(product.id);
    const done =
      priority === PRIORITY.normal ? isDetailLoaded(entry) : isDetailLive(entry);
    if (done) continue;
    queuedIds.add(product.id);
    buckets[priority].push({ product, priority });
    added += 1;
  }
}

/**
 * Replaces pending prefetch work with the products currently on screen.
 * In-flight requests finish and still populate the cache.
 */
export function scheduleProductDetailPrefetch(request: ProductPrefetchRequest) {
  ensureAppStateListener();
  generation += 1;
  const gen = generation;
  if (request.isGuest !== currentIsGuest) zipLookup = null;
  currentIsGuest = request.isGuest;
  if (request.zip) currentZip = request.zip;

  for (const bucket of buckets) bucket.length = 0;
  queuedIds.clear();

  const rules = (request.preferenceRules ?? []).filter(
    (rule) => rule.mode === 'prefer' || rule.mode === 'require',
  );
  const seen = new Set<string>();
  const dedupe = (rows: Product[]) =>
    rows.filter((row) => {
      if (!row?.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  const trending = dedupe(request.trending);
  const preferred = dedupe(request.preferred);
  const normal = dedupe(request.normal);

  enqueue(trending, PRIORITY.trending);
  enqueue(preferred, PRIORITY.preferred);
  enqueue(normal, PRIORITY.normal, MAX_NORMAL_PER_SCHEDULE);
  pump();

  // Traits feed the popup's "matches your preferences" chips and promote preference matches.
  void (async () => {
    try {
      await waitUntilRunnable();
      await waitForIdle();
      await Promise.all([
        loadFoodTraits(),
        loadProductTraits([...trending, ...preferred, ...normal].map((row) => row.id)),
      ]);
      if (gen !== generation || rules.length === 0) return;
      const promoted = normal.filter((row) => productMatchesPreferences(row.id, rules));
      if (promoted.length === 0) return;
      const promotedIds = new Set(promoted.map((row) => row.id));
      buckets[PRIORITY.normal] = buckets[PRIORITY.normal].filter((item) => {
        if (!promotedIds.has(item.product.id)) return true;
        queuedIds.delete(item.product.id);
        return false;
      });
      enqueue(promoted, PRIORITY.preferred);
      pump();
    } catch {
      // Traits are optional for prefetch.
    }
  })();
}
