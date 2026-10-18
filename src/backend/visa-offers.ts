import { BACKEND_URL } from '../api/config';

import type { VisaMerchantOffer } from './net-price';

export type VisaOffersResponse = {
  offers: VisaMerchantOffer[];
  source: 'visa_sandbox' | 'demo';
};

let cache: { at: number; key: string; body: VisaOffersResponse } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Fetches Visa merchant offers from the price proxy (VMORC or demo fallback).
 * Safe to call with no credentials — demo offers are always returned.
 */
export async function fetchVisaMerchantOffers(merchant?: string): Promise<VisaOffersResponse> {
  const key = (merchant ?? '').trim().toLowerCase();
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    return cache.body;
  }

  try {
    const url = new URL('/api/visa/offers', BACKEND_URL);
    if (key) url.searchParams.set('merchant', key);
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Visa offers failed (${response.status})`);
    }
    const body = (await response.json()) as VisaOffersResponse;
    const normalized: VisaOffersResponse = {
      offers: Array.isArray(body.offers) ? body.offers : [],
      source: body.source === 'visa_sandbox' ? 'visa_sandbox' : 'demo',
    };
    cache = { at: Date.now(), key, body: normalized };
    return normalized;
  } catch {
    // Offline / proxy down — still show store comparison without Visa layer.
    return { offers: [], source: 'demo' };
  }
}
