/**
 * Pay-aware “true cost” after optional grocery cashback and Visa merchant offers.
 * Never touches card numbers — only a flat grocery rate (bps) and offer metadata.
 */

export type VisaMerchantOffer = {
  merchantName: string;
  chainKeys: string[];
  title: string;
  shortDescription: string;
  rewardType: 'percent' | 'fixed';
  rewardBps?: number;
  rewardCents?: number;
  validThrough: string | null;
  source: 'visa_sandbox' | 'demo';
};

export type NetPriceBreakdown = {
  shelfCents: number;
  cashbackCents: number;
  visaOfferCents: number;
  netCents: number;
  groceryRateBps: number | null;
  visaOffer: VisaMerchantOffer | null;
};

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '');
}

/** Chains where a shopper's grocery-category rate applies. Visa offers stay separate. */
const GROCERY_CASHBACK_KEYS = ['qfc', 'safeway', 'fred meyer', 'trader joe', 'whole foods'];

export function isGroceryCashbackChain(name: string | null | undefined): boolean {
  const hay = normalizeName(name);
  if (!hay) return false;
  return GROCERY_CASHBACK_KEYS.some((key) => hay.includes(key));
}

/** Whether a Visa offer applies to this chain/store display name. */
export function visaOfferMatchesChain(
  offer: VisaMerchantOffer,
  chainOrStoreName: string | null | undefined,
): boolean {
  const hay = normalizeName(chainOrStoreName);
  if (!hay) return false;
  const merchant = normalizeName(offer.merchantName);
  if (hay.includes(merchant) || merchant.includes(hay)) return true;
  return offer.chainKeys.some((key) => hay.includes(normalizeName(key)));
}

export function pickBestVisaOffer(
  offers: VisaMerchantOffer[],
  chainOrStoreName: string | null | undefined,
  shelfCents: number,
): VisaMerchantOffer | null {
  const matched = offers.filter((offer) => visaOfferMatchesChain(offer, chainOrStoreName));
  if (matched.length === 0) return null;
  return matched.reduce((best, offer) => {
    const bestValue = visaOfferValueCents(best, shelfCents);
    const nextValue = visaOfferValueCents(offer, shelfCents);
    return nextValue > bestValue ? offer : best;
  });
}

export function visaOfferValueCents(offer: VisaMerchantOffer, shelfCents: number): number {
  if (offer.rewardType === 'fixed') {
    return Math.max(0, Math.min(shelfCents, offer.rewardCents ?? 0));
  }
  const bps = offer.rewardBps ?? 0;
  return Math.floor((shelfCents * bps) / 10000);
}

/** Apply a flat grocery cashback rate to a product→price map (shop “Cheapest” sort). */
export function applyCashbackToPriceMap(
  priceCentsByProduct: Map<string, number>,
  groceryRateBps: number | null | undefined,
): Map<string, number> {
  if (groceryRateBps == null || groceryRateBps <= 0) return priceCentsByProduct;
  const next = new Map<string, number>();
  for (const [id, cents] of priceCentsByProduct) {
    next.set(id, Math.max(0, cents - Math.floor((cents * groceryRateBps) / 10000)));
  }
  return next;
}

/**
 * net = shelf − grocery cashback − Visa merchant offer (floored at 0).
 * The shopper rate applies only at grocery chains. A Visa offer applies only when the chain matches.
 */
export function computeNetPrice(
  shelfCents: number,
  groceryRateBps: number | null | undefined,
  chainOrStoreName: string | null | undefined,
  visaOffers: VisaMerchantOffer[] = [],
): NetPriceBreakdown {
  const shelf = Number.isInteger(shelfCents) && shelfCents >= 0 ? shelfCents : 0;
  const bps =
    groceryRateBps != null && Number.isInteger(groceryRateBps) && groceryRateBps > 0
      ? groceryRateBps
      : null;
  const rateApplies = bps != null && isGroceryCashbackChain(chainOrStoreName);
  const cashbackCents = rateApplies ? Math.floor((shelf * (bps ?? 0)) / 10000) : 0;
  const visaOffer = pickBestVisaOffer(visaOffers, chainOrStoreName, shelf);
  const visaOfferCents = visaOffer ? visaOfferValueCents(visaOffer, shelf) : 0;
  const netCents = Math.max(0, shelf - cashbackCents - visaOfferCents);
  return {
    shelfCents: shelf,
    cashbackCents,
    visaOfferCents,
    netCents,
    groceryRateBps: rateApplies ? bps : null,
    visaOffer,
  };
}
