/**
 * Validate → Match → write for shelf and promotion envelopes.
 */

import { promotionOffer, shelfOffer } from "./envelope.js";
import { nullOnlyProductPatch, shouldAppendAutomatedPrice } from "./refreshPriority.js";

const MAX_SHELF_CENTS_WITHOUT_UPC = 50_000; // $500
const KNOWN_GROUPS = new Set(["senior", "veteran", "student"]);

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function canIngest() {
  return supabaseConfig() !== null;
}

async function rest(path, options = {}) {
  const config = supabaseConfig();
  if (!config) return null;
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Could not save the offer (${res.status}).`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function chainId(name) {
  const rows = await rest(`chains?name=eq.${encodeURIComponent(name)}&select=id&limit=1`);
  return rows?.[0]?.id ?? null;
}

async function findProduct({ upc, productName, brand }) {
  if (upc) {
    const rows = await rest(`products?upc=eq.${encodeURIComponent(upc)}&select=id&limit=1`);
    if (rows?.[0]?.id) return rows[0].id;
  }
  if (!productName) return null;
  const name = encodeURIComponent(productName);
  const rows = await rest(`products?name=eq.${name}&select=id,brand&limit=20`);
  const brandValue = String(brand ?? "");
  return (rows ?? []).find((row) => String(row.brand ?? "") === brandValue)?.id ?? null;
}

async function loadTrustedPrice(storeProductId) {
  try {
    const rows = await rest(
      `trusted_current_prices?store_product_id=eq.${storeProductId}&select=source,created_at,is_stale,price_cents&limit=1`,
    );
    return rows?.[0] ?? null;
  } catch {
    const reports = await rest(
      `prices?store_product_id=eq.${storeProductId}&source=eq.user_report&select=source,created_at,price_cents&order=created_at.desc&limit=1`,
    );
    return reports?.[0] ?? null;
  }
}

function validateShelf(offer) {
  if (offer.kind !== "shelf") throw new Error("Expected a shelf offer.");
  if (!["api", "scrape", "user_report"].includes(offer.source)) {
    throw new Error("Shelf source must be api, scrape, or user_report.");
  }
  if (!offer.chainName?.trim()) throw new Error("chainName is required.");
  if (!offer.storeSource?.trim() || offer.storeRef == null || offer.storeRef === "") {
    throw new Error("storeSource and storeRef are required.");
  }
  if (!offer.storeName?.trim()) throw new Error("storeName is required.");
  if (!offer.productName?.trim()) throw new Error("productName is required.");
  if (!Number.isInteger(offer.priceCents) || offer.priceCents < 0) {
    throw new Error("priceCents must be a non-negative integer.");
  }
  if (
    offer.priceCents > MAX_SHELF_CENTS_WITHOUT_UPC &&
    !offer.upc &&
    offer.source !== "user_report"
  ) {
    throw new Error("Automated shelf price over $500 requires a UPC.");
  }
  return true;
}

function validatePromotion(offer) {
  if (offer.kind !== "promotion") throw new Error("Expected a promotion offer.");
  if (!offer.chainName?.trim()) throw new Error("chainName is required.");
  if (!["percent_off", "amount_off", "bogo"].includes(offer.discountType)) {
    throw new Error("Invalid discountType.");
  }
  if (offer.discountType === "percent_off") {
    if (typeof offer.discountValue !== "number" || offer.discountValue < 0 || offer.discountValue > 100) {
      throw new Error("percent_off discountValue must be 0–100.");
    }
  } else if (offer.discountType === "amount_off") {
    if (typeof offer.discountValue !== "number" || offer.discountValue < 0) {
      throw new Error("amount_off discountValue must be >= 0.");
    }
  }
  if (offer.requiresGroup != null && !KNOWN_GROUPS.has(offer.requiresGroup)) {
    throw new Error(`Unknown requiresGroup: ${offer.requiresGroup}.`);
  }
  if (!offer.startsAt || !offer.endsAt) throw new Error("startsAt and endsAt are required.");
  if (new Date(offer.endsAt) <= new Date(offer.startsAt)) {
    throw new Error("endsAt must be after startsAt.");
  }
  for (const day of offer.weekdays ?? []) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error("weekdays must be integers 0–6.");
    }
  }
  for (const day of offer.monthDays ?? []) {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error("monthDays must be integers 1–31.");
    }
  }
  for (const ordinal of offer.monthOrdinals ?? []) {
    if (!Number.isInteger(ordinal) || ![-1, 1, 2, 3, 4, 5].includes(ordinal)) {
      throw new Error("monthOrdinals must be -1 or 1–5.");
    }
  }
  return true;
}

/**
 * Validate, match store/product, append a prices row.
 * @param {import('./envelope.js').ShelfOffer | object} raw
 * @returns {Promise<boolean>} true when saved or duplicate skipped; false when ingest is disabled
 */
export async function ingestShelf(raw) {
  if (!canIngest()) return false;
  const offer = raw.kind === "shelf" ? raw : shelfOffer(raw);
  validateShelf(offer);

  const chain = await chainId(offer.chainName);
  if (!chain) throw new Error(`Chain ${offer.chainName} is not in the database yet.`);

  const stores = await rest("stores?on_conflict=source,source_ref", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      name: offer.storeName,
      chain_id: chain,
      address_line1: offer.address,
      city: offer.city,
      region: offer.region,
      postal_code: offer.postalCode,
      latitude: offer.latitude,
      longitude: offer.longitude,
      source: offer.storeSource,
      source_ref: String(offer.storeRef),
    }),
  });
  const storeId = stores?.[0]?.id;
  if (!storeId) throw new Error("Store save did not return a row.");

  let productId = await findProduct(offer);
  if (!productId) {
    const created = await rest("products", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: offer.productName,
        brand: offer.brand,
        upc: offer.upc,
      }),
    });
    productId = created?.[0]?.id;
  }
  if (!productId) throw new Error("Product save did not return a row.");

  const existingProducts = await rest(
    `products?id=eq.${productId}&select=id,upc,brand,size_base_amount,size_base_unit&limit=1`,
  );
  const existing = existingProducts?.[0];
  if (existing) {
    const patch = nullOnlyProductPatch(existing, {
      upc: offer.upc,
      brand: offer.brand,
      sizeBaseAmount: offer.sizeBaseAmount ?? null,
      sizeBaseUnit: offer.sizeBaseUnit ?? null,
    });
    if (Object.keys(patch).length > 0) {
      await rest(`products?id=eq.${productId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    }
  }

  const listings = await rest("store_products?on_conflict=store_id,product_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      store_id: storeId,
      product_id: productId,
      store_sku: offer.externalRef,
      product_url: offer.productUrl,
      is_available: true,
    }),
  });
  const storeProductId = listings?.[0]?.id;
  if (!storeProductId) throw new Error("Listing save did not return a row.");

  const trusted = await loadTrustedPrice(storeProductId);

  if (!shouldAppendAutomatedPrice(offer.source, trusted)) {
    // Fresh manual report is the authority; still filled null attributes above.
    return true;
  }

  if (trusted?.price_cents === offer.priceCents && trusted?.source === offer.source) {
    return true;
  }

  const latest = await rest(
    `prices?store_product_id=eq.${storeProductId}&select=price_cents&order=created_at.desc&limit=1`,
  );
  if (latest?.[0]?.price_cents === offer.priceCents) return true;

  const row = {
    store_product_id: storeProductId,
    price_cents: offer.priceCents,
    source: offer.source,
    regular_price_cents: offer.regularPriceCents,
    external_ref: offer.externalRef,
  };

  await rest("prices", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  return true;
}

/**
 * Validate and upsert a promotions row (weekly ads / discount policies).
 * @param {import('./envelope.js').PromotionOffer | object} raw
 * @returns {Promise<boolean>}
 */
export async function ingestPromotion(raw) {
  if (!canIngest()) return false;
  const offer = raw.kind === "promotion" ? raw : promotionOffer(raw);
  validatePromotion(offer);

  const chain = await chainId(offer.chainName);
  if (!chain) throw new Error(`Chain ${offer.chainName} is not in the database yet.`);

  let productId = null;
  if (offer.productUpc || offer.productName) {
    productId = await findProduct({
      upc: offer.productUpc,
      productName: offer.productName,
      brand: null,
    });
  }

  const externalRef =
    offer.externalRef ??
    `chain:${offer.chainName}|group:${offer.requiresGroup ?? "any"}|${offer.startsAt}|${offer.endsAt}`;

  const row = {
    chain_id: chain,
    product_id: productId,
    discount_type: offer.discountType,
    discount_value: offer.discountValue,
    requires_group: offer.requiresGroup,
    weekdays: offer.weekdays,
    month_days: offer.monthDays,
    month_ordinals: offer.monthOrdinals,
    starts_at: offer.startsAt,
    ends_at: offer.endsAt,
    external_ref: externalRef,
  };

  const byRef = await rest(
    `promotions?external_ref=eq.${encodeURIComponent(externalRef)}&select=id&limit=1`,
  );
  if (byRef?.[0]?.id) {
    await rest(`promotions?id=eq.${byRef[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    return true;
  }

  const groupFilter =
    offer.requiresGroup == null
      ? "requires_group=is.null"
      : `requires_group=eq.${encodeURIComponent(offer.requiresGroup)}`;
  const existing = await rest(
    `promotions?chain_id=eq.${chain}&${groupFilter}&select=id&limit=1`,
  );
  if (existing?.[0]?.id) {
    await rest(`promotions?id=eq.${existing[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    return true;
  }

  await rest("promotions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  return true;
}
