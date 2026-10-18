import { BACKEND_URL } from '../../api/config';
import { supabase } from './client';
import { todayLocalDateKey } from './localTime';

export type OpenPriceRow = {
  priceCents: number | null;
  currency: string | null;
  date: string | null;
  storeName: string;
  city: string | null;
  country?: string | null;
  source: string;
  productCode?: string;
};

export type OpenPricesGeo = {
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number;
};

/** Coarse ~11 km cell so nearby shoppers share a cache entry. */
export function openPricesGeoKey(geo?: OpenPricesGeo | null): string {
  const lat = geo?.latitude;
  const lng = geo?.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'global';
  }
  const radius = Math.min(Math.max(geo?.radiusKm ?? 80, 1), 200);
  return `${lat.toFixed(1)},${lng.toFixed(1)},r${radius}`;
}

function normalizeUpc(upc: string | null | undefined): string | null {
  const code = String(upc ?? '').replace(/\D/g, '');
  return /^\d{8,14}$/.test(code) ? code : null;
}

/**
 * Crowd-sourced USD shelf prices by barcode via the price proxy.
 */
export async function fetchOpenPricesByUpc(
  upc: string,
  geo?: OpenPricesGeo | null,
): Promise<OpenPriceRow[]> {
  const map = await fetchOpenPricesByUpcs([upc], geo);
  const code = normalizeUpc(upc);
  return code ? (map.get(code) ?? []) : [];
}

/**
 * Batch Open Prices lookup. Prefer nearby USD when geo is provided.
 */
export async function fetchOpenPricesByUpcs(
  upcs: string[],
  geo?: OpenPricesGeo | null,
): Promise<Map<string, OpenPriceRow[]>> {
  const codes = [...new Set(upcs.map(normalizeUpc).filter((c): c is string => Boolean(c)))];
  const out = new Map<string, OpenPriceRow[]>(codes.map((c) => [c, []]));
  if (codes.length === 0) return out;

  try {
    const params = new URLSearchParams();
    if (codes.length === 1) {
      params.set('upc', codes[0]);
    } else {
      params.set('upcs', codes.join(','));
    }
    if (geo?.latitude != null && geo?.longitude != null) {
      params.set('lat', String(geo.latitude));
      params.set('lng', String(geo.longitude));
      if (geo.radiusKm != null) params.set('radius_km', String(geo.radiusKm));
    }

    const res = await fetch(`${BACKEND_URL}/api/open-prices?${params}`);
    if (!res.ok) return out;
    const body = (await res.json().catch(() => null)) as {
      prices?: OpenPriceRow[];
      pricesByUpc?: Record<string, OpenPriceRow[]>;
      upc?: string;
    } | null;

    if (body?.pricesByUpc) {
      for (const [code, rows] of Object.entries(body.pricesByUpc)) {
        const list = Array.isArray(rows) ? rows : [];
        out.set(
          code,
          list.filter((row) => Number.isInteger(row.priceCents) && (row.priceCents ?? 0) > 0),
        );
      }
      return out;
    }

    if (codes.length === 1 && Array.isArray(body?.prices)) {
      out.set(
        codes[0],
        body.prices.filter((row) => Number.isInteger(row.priceCents) && (row.priceCents ?? 0) > 0),
      );
    }
    return out;
  } catch {
    return out;
  }
}

type CacheRow = {
  upc: string;
  price_cents: number | null;
  currency: string | null;
  store_name: string | null;
  city: string | null;
  country: string | null;
  observed_date: string | null;
};

/**
 * Read today's cached Open Prices for UPCs (including negative cache nulls).
 */
export async function readOpenPricesCache(
  upcs: string[],
  geo?: OpenPricesGeo | null,
): Promise<Map<string, number | null>> {
  const codes = [...new Set(upcs.map(normalizeUpc).filter((c): c is string => Boolean(c)))];
  const prices = new Map<string, number | null>();
  if (codes.length === 0) return prices;

  const geoKey = openPricesGeoKey(geo);
  const priceDay = todayLocalDateKey();
  const { data, error } = await supabase
    .from('open_prices_cache')
    .select('upc, price_cents')
    .in('upc', codes)
    .eq('geo_key', geoKey)
    .eq('price_day', priceDay);

  if (error || !data) return prices;
  for (const row of data as Pick<CacheRow, 'upc' | 'price_cents'>[]) {
    prices.set(row.upc, row.price_cents);
  }
  return prices;
}

/**
 * Upsert today's Open Prices cache entries (null price_cents = negative cache).
 */
export async function writeOpenPricesCache(
  entries: {
    upc: string;
    priceCents: number | null;
    currency?: string | null;
    storeName?: string | null;
    city?: string | null;
    country?: string | null;
    observedDate?: string | null;
  }[],
  geo?: OpenPricesGeo | null,
): Promise<void> {
  if (entries.length === 0) return;
  const geoKey = openPricesGeoKey(geo);
  const priceDay = todayLocalDateKey();
  const rows = entries
    .map((entry) => {
      const upc = normalizeUpc(entry.upc);
      if (!upc) return null;
      return {
        upc,
        geo_key: geoKey,
        price_day: priceDay,
        price_cents: entry.priceCents,
        currency: entry.currency ?? null,
        store_name: entry.storeName ?? null,
        city: entry.city ?? null,
        country: entry.country ?? null,
        observed_date: entry.observedDate ?? null,
        fetched_at: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (rows.length === 0) return;
  // Ignore errors (migration not applied yet, RLS, etc.) — live fetch still works.
  await supabase.from('open_prices_cache').upsert(rows, {
    onConflict: 'upc,geo_key,price_day',
  });
}

const OPEN_PRICES_BATCH = 10;

/**
 * Cheapest Open Prices cents by UPC, using day+geo cache then batch API for misses.
 */
export async function getOpenPricesCentsByUpcs(
  upcs: string[],
  geo?: OpenPricesGeo | null,
): Promise<Map<string, number>> {
  const codes = [...new Set(upcs.map(normalizeUpc).filter((c): c is string => Boolean(c)))];
  const result = new Map<string, number>();
  if (codes.length === 0) return result;

  const cached = await readOpenPricesCache(codes, geo);
  const missing: string[] = [];
  for (const code of codes) {
    if (!cached.has(code)) {
      missing.push(code);
      continue;
    }
    const cents = cached.get(code);
    if (cents != null && cents > 0) result.set(code, cents);
  }

  for (let i = 0; i < missing.length; i += OPEN_PRICES_BATCH) {
    const chunk = missing.slice(i, i + OPEN_PRICES_BATCH);
    const fetched = await fetchOpenPricesByUpcs(chunk, geo);
    const toWrite: {
      upc: string;
      priceCents: number | null;
      currency?: string | null;
      storeName?: string | null;
      city?: string | null;
      country?: string | null;
      observedDate?: string | null;
    }[] = [];

    for (const code of chunk) {
      const rows = fetched.get(code) ?? [];
      const best = rows[0];
      if (best?.priceCents != null && best.priceCents > 0) {
        result.set(code, best.priceCents);
        toWrite.push({
          upc: code,
          priceCents: best.priceCents,
          currency: best.currency,
          storeName: best.storeName,
          city: best.city,
          country: best.country ?? null,
          observedDate: best.date,
        });
      } else {
        toWrite.push({ upc: code, priceCents: null });
      }
    }
    await writeOpenPricesCache(toWrite, geo);
  }

  return result;
}

/**
 * Fire-and-forget contribute of a user-reported price to Open Prices.
 */
export async function contributeReportedPriceToOpenPrices(input: {
  upc?: string | null;
  priceCents: number;
  storeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<void> {
  const upc = normalizeUpc(input.upc);
  if (!upc || !Number.isInteger(input.priceCents) || input.priceCents <= 0) return;

  try {
    await fetch(`${BACKEND_URL}/api/open-prices/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upc,
        priceCents: input.priceCents,
        storeName: input.storeName ?? undefined,
        lat: input.latitude ?? undefined,
        lng: input.longitude ?? undefined,
        date: todayLocalDateKey(),
      }),
    });
  } catch {
    // Best-effort only.
  }
}
