// src/api/openPrices.js — prefer backend proxy (CORS + stable shape)
import { BACKEND_URL } from './config';

/**
 * Crowd-sourced prices by barcode (Open Prices / Open Food Facts).
 * @param {string} barcode
 */
export async function getCrowdsourcedPrices(barcode) {
  const code = String(barcode ?? '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(code)) return [];

  const res = await fetch(`${BACKEND_URL}/api/open-prices?upc=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error('Open Prices request failed');
  const json = await res.json();
  const prices = Array.isArray(json.prices) ? json.prices : [];

  return prices.map((p) => ({
    price: p.priceCents != null ? p.priceCents / 100 : null,
    currency: p.currency,
    date: p.date,
    store: p.storeName ?? 'Unknown store',
    city: p.city,
    source: 'Open Prices',
  }));
}
