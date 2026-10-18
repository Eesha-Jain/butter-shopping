import { BACKEND_URL } from '../../api/config';

export type OpenPriceRow = {
  priceCents: number | null;
  currency: string | null;
  date: string | null;
  storeName: string;
  city: string | null;
  country?: string | null;
  source: string;
};

/**
 * Crowd-sourced USD shelf prices by barcode via the price proxy.
 */
export async function fetchOpenPricesByUpc(upc: string): Promise<OpenPriceRow[]> {
  const code = String(upc ?? '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(code)) return [];

  try {
    const params = new URLSearchParams({ upc: code });
    const res = await fetch(`${BACKEND_URL}/api/open-prices?${params}`);
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as {
      prices?: OpenPriceRow[];
    } | null;
    const prices = Array.isArray(body?.prices) ? body.prices : [];
    return prices.filter((row) => Number.isInteger(row.priceCents) && (row.priceCents ?? 0) > 0);
  } catch {
    return [];
  }
}
