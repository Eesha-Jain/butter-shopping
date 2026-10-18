/**
 * Weekly-ad Collect adapter.
 *
 * Retailer circular HTML/JSON varies by banner. This module normalizes a list of
 * deal rows into promotionOffer envelopes; callers fetch the ad and map fields.
 *
 * Prefer productUpc so ingestPromotion can attach product_id.
 */

import { promotionOffer } from "../envelope.js";

/**
 * @typedef {object} WeeklyAdDeal
 * @property {string | null} [productUpc]
 * @property {string | null} [productName]
 * @property {string | null} [productBrand]
 * @property {'percent_off' | 'amount_off' | 'bogo'} discountType
 * @property {number} discountValue
 * @property {number | null} [buyQuantity]
 * @property {number | null} [getQuantity]
 * @property {string | null} [label]
 * @property {string | null} [externalRef]
 * @property {string | null} [startsAt]
 * @property {string | null} [endsAt]
 */

/**
 * @param {object} input
 * @param {string} input.chainName
 * @param {string} input.startsAt
 * @param {string} input.endsAt
 * @param {WeeklyAdDeal[]} input.deals
 * @returns {import('../envelope.js').PromotionOffer[]}
 */
export function weeklyAdPromotionOffers(input) {
  const chainName = String(input.chainName ?? "").trim();
  const startsAt = input.startsAt;
  const endsAt = input.endsAt;
  const weekKey = String(startsAt ?? "").slice(0, 10);
  return (input.deals ?? [])
    .filter((deal) => deal.productUpc || deal.productName)
    .map((deal, index) =>
      promotionOffer({
        chainName,
        discountType: deal.discountType,
        discountValue: deal.discountValue,
        buyQuantity: deal.buyQuantity ?? null,
        getQuantity: deal.getQuantity ?? null,
        label: deal.label ?? null,
        startsAt: deal.startsAt ?? startsAt,
        endsAt: deal.endsAt ?? endsAt,
        productUpc: deal.productUpc ?? null,
        productName: deal.productName ?? null,
        productBrand: deal.productBrand ?? null,
        externalRef:
          deal.externalRef ??
          `weekly-ad:${chainName.toLowerCase().replace(/\s+/g, "-")}:${weekKey}:${deal.productUpc ?? index}`,
      }),
    );
}
