/**
 * Stability helpers for Collect refresh ordering.
 * Manual non-stale prices win; automation only fills holes.
 */

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * True when the trusted price is a user_report newer than 24 hours.
 * @param {{ source?: string, created_at?: string, is_stale?: boolean } | null} trusted
 */
export function hasFreshManualPrice(trusted) {
  if (!trusted || trusted.source !== "user_report") return false;
  if (typeof trusted.is_stale === "boolean") return !trusted.is_stale;
  if (!trusted.created_at) return false;
  return Date.now() - new Date(trusted.created_at).getTime() < STALE_MS;
}

/**
 * Whether an automated (api/scrape) shelf observation should append a prices row.
 * @param {string} source
 * @param {{ source?: string, created_at?: string, is_stale?: boolean } | null} trusted
 */
export function shouldAppendAutomatedPrice(source, trusted) {
  if (source === "user_report") return true;
  if (hasFreshManualPrice(trusted)) return false;
  return true;
}

/**
 * Patch for products: only fill currently null fields from the observation.
 * @param {{ upc?: string | null, brand?: string | null, size_base_amount?: number | null, size_base_unit?: string | null, image_path?: string | null }} existing
 * @param {{ upc?: string | null, brand?: string | null, sizeBaseAmount?: number | null, sizeBaseUnit?: string | null, imageUrl?: string | null }} incoming
 */
export function nullOnlyProductPatch(existing, incoming) {
  const patch = {};
  if (existing.upc == null && incoming.upc) patch.upc = incoming.upc;
  if (existing.brand == null && incoming.brand) patch.brand = incoming.brand;
  if ((existing.image_path == null || existing.image_path === "") && incoming.imageUrl) {
    const imageUrl = String(incoming.imageUrl).trim();
    if (/^https?:\/\//i.test(imageUrl)) patch.image_path = imageUrl;
  }
  if (
    existing.size_base_amount == null &&
    incoming.sizeBaseAmount != null &&
    Number(incoming.sizeBaseAmount) > 0 &&
    incoming.sizeBaseUnit
  ) {
    patch.size_base_amount = incoming.sizeBaseAmount;
    patch.size_base_unit = incoming.sizeBaseUnit;
  }
  return patch;
}
