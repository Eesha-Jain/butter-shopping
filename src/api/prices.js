import { listReportedOffers } from "../backend/supabase/catalog";
import { BACKEND_URL } from "./config";

function offerKey(offer) {
  const store = String(offer.store ?? "").toLowerCase();
  const upc = offer.upc ? String(offer.upc) : "";
  const productId = offer.productId ? String(offer.productId) : "";
  const name = String(offer.name ?? "").toLowerCase();
  return `${store}|${upc || productId || name}`;
}

/**
 * Picks the trusted price per store+product. user_report beats api/scrape.
 * Among the same source, the lower priceCents wins.
 */
export function mergeOffers(automated, reported) {
  const byKey = new Map();
  for (const offer of [...automated, ...reported]) {
    if (!Number.isInteger(offer.priceCents)) continue;
    const key = offerKey(offer);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, offer);
      continue;
    }
    const existingManual = existing.source === "user_report";
    const nextManual = offer.source === "user_report";
    if (nextManual && !existingManual) {
      byKey.set(key, offer);
      continue;
    }
    if (existingManual && !nextManual) continue;
    if (offer.priceCents < existing.priceCents) byKey.set(key, offer);
  }
  return [...byKey.values()];
}

function lowestOffer(offers) {
  const priced = offers.filter((offer) => Number.isInteger(offer.priceCents));
  if (priced.length === 0) return null;
  return priced.reduce((best, offer) => (offer.priceCents < best.priceCents ? offer : best));
}

/**
 * Prices one item at Safeway, QFC, Fred Meyer, and Trader Joe's, then merges
 * saved user_report prices from any store. Manual reports override automated
 * prices for the same store+product. `lowest` uses that trusted set.
 * @param {{ term: string, zip?: string, locationId?: string }} input
 */
export async function searchShelfPrices({ term, zip, locationId }) {
  const params = new URLSearchParams({ term });
  if (zip) params.set("zip", zip);
  if (locationId) params.set("locationId", locationId);

  let automated = [];
  let qfcError = null;
  let fredMeyerError = null;
  let safewayError = null;
  let traderJoesError = null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/prices?${params}`);
    const json = await res.json().catch(() => ({}));
    automated = json.offers ?? [];
    qfcError = json.qfcError ?? null;
    fredMeyerError = json.fredMeyerError ?? null;
    safewayError = json.safewayError ?? null;
    traderJoesError = json.traderJoesError ?? null;
    if (
      !res.ok &&
      automated.length === 0 &&
      !qfcError &&
      !fredMeyerError &&
      !safewayError &&
      !traderJoesError
    ) {
      throw new Error(json.error ?? "Could not load prices");
    }
  } catch (error) {
    qfcError = qfcError ?? error.message;
    fredMeyerError = fredMeyerError ?? error.message;
    safewayError = safewayError ?? error.message;
    traderJoesError = traderJoesError ?? error.message;
  }

  let reports = [];
  let reportError = null;
  try {
    reports = await listReportedOffers(term);
  } catch (error) {
    reportError = error.message;
  }

  const offers = mergeOffers(automated, reports);

  return {
    offers,
    lowest: lowestOffer(offers),
    qfcError,
    fredMeyerError,
    safewayError,
    traderJoesError,
    reportError,
  };
}
