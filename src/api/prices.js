import { listReportedOffers } from "../backend/supabase/catalog";
import { BACKEND_URL } from "./config";

function lowestOffer(offers) {
  const priced = offers.filter((offer) => Number.isInteger(offer.priceCents));
  if (priced.length === 0) return null;
  return priced.reduce((best, offer) => (offer.priceCents < best.priceCents ? offer : best));
}

/**
 * Prices one item at Safeway, then QFC, then saved Trader Joe's and campus
 * reports. Every source is kept. `lowest` is the smallest priceCents.
 * @param {{ term: string, zip?: string, locationId?: string }} input
 */
export async function searchShelfPrices({ term, zip, locationId }) {
  const params = new URLSearchParams({ term });
  if (zip) params.set("zip", zip);
  if (locationId) params.set("locationId", locationId);

  let offers = [];
  let qfcError = null;
  let safewayError = null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/prices?${params}`);
    const json = await res.json().catch(() => ({}));
    offers = json.offers ?? [];
    qfcError = json.qfcError ?? null;
    safewayError = json.safewayError ?? null;
    if (!res.ok && offers.length === 0 && !qfcError && !safewayError) {
      throw new Error(json.error ?? "Could not load prices");
    }
  } catch (error) {
    qfcError = qfcError ?? error.message;
    safewayError = safewayError ?? error.message;
  }

  let reportError = null;
  try {
    offers = offers.concat(await listReportedOffers(term));
  } catch (error) {
    reportError = error.message;
  }

  return {
    offers,
    lowest: lowestOffer(offers),
    qfcError,
    safewayError,
    reportError,
  };
}
