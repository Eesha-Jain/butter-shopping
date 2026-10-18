/**
 * Shared Normalize shapes for the Collect → Normalize → Validate → Match pipeline.
 *
 * Collectors map retailer APIs, scrapes, weekly ads, and user submissions into
 * one of these envelopes. Only ingest.js writes to Supabase.
 *
 * @typedef {'api' | 'scrape' | 'user_report'} PriceSource
 *
 * @typedef {object} ShelfOffer
 * @property {'shelf'} kind
 * @property {PriceSource} source
 * @property {string} chainName
 * @property {string} storeSource
 * @property {string} storeRef
 * @property {string} storeName
 * @property {string | null} [address]
 * @property {string | null} [city]
 * @property {string | null} [region]
 * @property {string | null} [postalCode]
 * @property {number | null} [latitude]
 * @property {number | null} [longitude]
 * @property {string} productName
 * @property {string | null} [brand]
 * @property {string | null} [upc]
 * @property {string | null} [externalRef]
 * @property {string | null} [productUrl]
 * @property {number} priceCents
 * @property {number | null} [regularPriceCents]
 * @property {number | null} [promoPriceCents]
 * @property {number | null} [sizeBaseAmount]
 * @property {'g' | 'ml' | 'ct' | null} [sizeBaseUnit]
 * @property {string | null} [imageUrl]
 * @property {boolean} [available]
 * @property {string | null} [observedAt]
 *
 * @typedef {object} PromotionOffer
 * @property {'promotion'} kind
 * @property {string} chainName
 * @property {string | null} [storeSource]
 * @property {string | null} [storeRef]
 * @property {'percent_off' | 'amount_off' | 'bogo'} discountType
 * @property {number} discountValue
 * @property {number | null} [buyQuantity]
 * @property {number | null} [getQuantity]
 * @property {string | null} [label]
 * @property {string | null} [requiresGroup]
 * @property {number[] | null} [weekdays]
 * @property {number[] | null} [monthDays]
 * @property {number[] | null} [monthOrdinals]
 * @property {string} startsAt
 * @property {string} endsAt
 * @property {string | null} [productUpc]
 * @property {string | null} [productName]
 * @property {string | null} [productBrand]
 * @property {string | null} [externalRef]
 */

/**
 * Builds a shelf envelope from a scraper product + store row.
 * @param {object} input
 * @returns {ShelfOffer}
 */
export function shelfOffer(input) {
  return {
    kind: "shelf",
    source: input.source,
    chainName: input.chainName,
    storeSource: input.storeSource,
    storeRef: String(input.storeRef),
    storeName: input.storeName,
    address: input.address ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    productName: input.productName,
    brand: input.brand ?? null,
    upc: input.upc ?? null,
    externalRef: input.externalRef ?? input.productRef ?? null,
    productUrl: input.productUrl ?? null,
    priceCents: input.priceCents,
    regularPriceCents: input.regularPriceCents ?? null,
    promoPriceCents: input.promoPriceCents ?? null,
    sizeBaseAmount: input.sizeBaseAmount ?? null,
    sizeBaseUnit: input.sizeBaseUnit ?? null,
    imageUrl: input.imageUrl ?? null,
    available: input.available !== false,
    observedAt: input.observedAt ?? null,
  };
}

/**
 * Builds a promotion envelope (weekly ads, SNAP discount JSON, etc.).
 * @param {object} input
 * @returns {PromotionOffer}
 */
export function promotionOffer(input) {
  return {
    kind: "promotion",
    chainName: input.chainName,
    storeSource: input.storeSource ?? null,
    storeRef: input.storeRef ?? null,
    discountType: input.discountType ?? "percent_off",
    discountValue: input.discountValue,
    buyQuantity: input.buyQuantity ?? null,
    getQuantity: input.getQuantity ?? null,
    label: input.label ?? null,
    requiresGroup: input.requiresGroup ?? null,
    weekdays: input.weekdays ?? null,
    monthDays: input.monthDays ?? null,
    monthOrdinals: input.monthOrdinals ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    productUpc: input.productUpc ?? null,
    productName: input.productName ?? null,
    productBrand: input.productBrand ?? null,
    externalRef: input.externalRef ?? null,
  };
}
