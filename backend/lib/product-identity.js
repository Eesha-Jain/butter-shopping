/**
 * Cross-store product identity: canonical UPC, fingerprint, display name.
 * Keep in sync with src/utils/product-identity.ts.
 */

export function upcLookupValues(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const stripped = digits.replace(/^0+/, "") || "0";
  return [...new Set([digits, stripped, stripped.padStart(12, "0"), stripped.padStart(13, "0")])];
}

/** Prefer GTIN-14 (zero-padded) when digits look like a barcode. */
export function canonicalizeUpc(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 14) return null;
  const stripped = digits.replace(/^0+/, "") || "0";
  if (stripped.length > 14) return null;
  return stripped.padStart(14, "0");
}

export function normalizeProductName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

const FLUFF =
  /\b(new|limited edition|value pack|family size|club size|select varieties?|assorted|various)\b/gi;

export function simplifyDisplayName(name) {
  let text = String(name ?? "").trim();
  if (!text) return "";
  text = text.replace(FLUFF, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^\d/.test(word) || word.length <= 2) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function buildProductFingerprint(input) {
  const brand = String(input.brand ?? "")
    .trim()
    .toLowerCase();
  const name = normalizeProductName(String(input.name ?? ""));
  if (!name) return null;
  const amount =
    input.sizeAmount != null && Number(input.sizeAmount) > 0
      ? String(Number(input.sizeAmount))
      : "";
  const unit = String(input.sizeUnit ?? "")
    .trim()
    .toLowerCase();
  if (!brand || !amount || !unit) return null;
  return `${brand}|${name}|${amount}|${unit}`;
}

export function productIdentityFields(input) {
  const display = simplifyDisplayName(String(input.name ?? ""));
  return {
    canonical_upc: canonicalizeUpc(input.upc),
    fingerprint: buildProductFingerprint(input),
    display_name: display || null,
  };
}
