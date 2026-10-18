/**
 * Validate → Match → write for shelf and promotion envelopes.
 */

import { categoryForProductName } from "../category-map.js";
import {
  canonicalizeUpc,
  productIdentityFields,
  upcLookupValues,
} from "../lib/product-identity.js";
import { promotionOffer, shelfOffer } from "./envelope.js";
import { nullOnlyProductPatch, shouldAppendAutomatedPrice } from "./refreshPriority.js";

const MAX_SHELF_CENTS_WITHOUT_UPC = 50_000; // $500
const KNOWN_GROUPS = new Set(["senior", "veteran", "student"]);
const pacificDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isPacificToday(iso) {
  if (!iso) return false;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return false;
  return pacificDay.format(when) === pacificDay.format(new Date());
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function canIngest() {
  return supabaseConfig() !== null;
}

/** Best-effort OFF sync (traits + category). Avoids importing persist.js (cycle). */
async function enrichComposition(upc) {
  const config = supabaseConfig();
  const code = String(upc ?? "").trim();
  if (!config || !code) return false;
  try {
    const res = await fetch(`${config.url}/functions/v1/sync-product-composition`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ upc: code }),
    });
    return res.ok;
  } catch {
    return false;
  }
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

async function findProduct({ upc, productName, brand, sizeBaseAmount, sizeBaseUnit }) {
  const canon = canonicalizeUpc(upc);
  if (canon) {
    const byCanon = await rest(
      `products?canonical_upc=eq.${encodeURIComponent(canon)}&is_active=eq.true&select=id&limit=1`,
    );
    if (byCanon?.[0]?.id) return byCanon[0].id;
  }

  const upcValues = upcLookupValues(upc);
  if (upcValues.length > 0) {
    const list = upcValues.map(encodeURIComponent).join(",");
    const rows = await rest(`products?upc=in.(${list})&select=id&limit=1`);
    if (rows?.[0]?.id) return rows[0].id;
  }

  const identity = productIdentityFields({
    upc,
    brand,
    name: productName,
    sizeAmount: sizeBaseAmount,
    sizeUnit: sizeBaseUnit,
  });
  if (identity.fingerprint) {
    const byFp = await rest(
      `products?fingerprint=eq.${encodeURIComponent(identity.fingerprint)}&is_active=eq.true&select=id&limit=1`,
    );
    if (byFp?.[0]?.id) return byFp[0].id;
  }

  if (!productName) return null;
  const name = String(productName).trim();
  const brandValue = String(brand ?? "")
    .trim()
    .toLowerCase();

  // Exact name + exact brand (legacy).
  const exactRows = await rest(
    `products?name=eq.${encodeURIComponent(name)}&select=id,brand&limit=20`,
  );
  const exactBrand = (exactRows ?? []).find(
    (row) =>
      String(row.brand ?? "")
        .trim()
        .toLowerCase() === brandValue,
  );
  if (exactBrand?.id) return exactBrand.id;

  // Case-insensitive name; brand must match when both sides have a brand.
  const ilikeRows = await rest(
    `products?name=ilike.${encodeURIComponent(name)}&select=id,name,brand&limit=30`,
  );
  const loose = (ilikeRows ?? []).find((row) => {
    if (
      String(row.name ?? "")
        .trim()
        .toLowerCase() !== name.toLowerCase()
    ) {
      return false;
    }
    const rowBrand = String(row.brand ?? "")
      .trim()
      .toLowerCase();
    if (!brandValue || !rowBrand) return true;
    return rowBrand === brandValue;
  });
  return loose?.id ?? null;
}

function absoluteImageUrl(value) {
  const raw = String(value ?? "").trim();
  return /^https?:\/\//i.test(raw) ? raw : null;
}

async function categoryIdForProductName(productName) {
  const categoryName = categoryForProductName(productName);
  if (!categoryName) return null;
  const rows = await rest(
    `product_categories?name=eq.${encodeURIComponent(categoryName)}&select=id&limit=1`,
  );
  return rows?.[0]?.id ?? null;
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

  let productId = await findProduct({
    upc: offer.upc,
    productName: offer.productName,
    brand: offer.brand,
    sizeBaseAmount: offer.sizeBaseAmount,
    sizeBaseUnit: offer.sizeBaseUnit,
  });
  let createdFresh = false;
  const identity = productIdentityFields({
    upc: offer.upc,
    brand: offer.brand,
    name: offer.productName,
    sizeAmount: offer.sizeBaseAmount,
    sizeUnit: offer.sizeBaseUnit,
  });
  if (!productId) {
    const categoryId = await categoryIdForProductName(offer.productName);
    const imagePath = absoluteImageUrl(offer.imageUrl);
    const created = await rest("products", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: offer.productName,
        brand: offer.brand,
        upc: offer.upc,
        canonical_upc: identity.canonical_upc,
        fingerprint: identity.fingerprint,
        display_name: identity.display_name,
        ...(imagePath ? { image_path: imagePath } : {}),
        ...(categoryId
          ? { category_id: categoryId, category_source: "keyword" }
          : {}),
        ...(offer.sizeBaseAmount != null && offer.sizeBaseUnit
          ? {
              size_base_amount: offer.sizeBaseAmount,
              size_base_unit: offer.sizeBaseUnit,
            }
          : {}),
      }),
    });
    productId = created?.[0]?.id;
    createdFresh = Boolean(productId);
  }
  if (!productId) throw new Error("Product save did not return a row.");

  const existingProducts = await rest(
    `products?id=eq.${productId}&select=id,upc,brand,size_base_amount,size_base_unit,image_path,category_id,category_source,canonical_upc,fingerprint,display_name&limit=1`,
  );
  const existing = existingProducts?.[0];
  if (existing) {
    const patch = nullOnlyProductPatch(existing, {
      upc: offer.upc,
      brand: offer.brand,
      sizeBaseAmount: offer.sizeBaseAmount ?? null,
      sizeBaseUnit: offer.sizeBaseUnit ?? null,
      imageUrl: offer.imageUrl ?? null,
      canonicalUpc: identity.canonical_upc,
      fingerprint: identity.fingerprint,
      displayName: identity.display_name,
    });
    if (!existing.category_id) {
      const categoryId = await categoryIdForProductName(offer.productName);
      if (categoryId) {
        patch.category_id = categoryId;
        patch.category_source = "keyword";
      }
    }
    if (Object.keys(patch).length > 0) {
      await rest(`products?id=eq.${productId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    }
  }

  // OFF taxonomy can upgrade keyword categories when a UPC is known.
  const upcForEnrich = offer.upc ?? existing?.upc;
  if (
    upcForEnrich &&
    (createdFresh || !existing?.category_source || existing.category_source === "keyword")
  ) {
    await enrichComposition(upcForEnrich);
  }

  const listings = await rest("store_products?on_conflict=store_id,product_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      store_id: storeId,
      product_id: productId,
      store_sku: offer.externalRef,
      product_url: offer.productUrl,
      is_available: offer.available !== false,
    }),
  });
  const storeProductId = listings?.[0]?.id;
  if (!storeProductId) throw new Error("Listing save did not return a row.");

  const trusted = await loadTrustedPrice(storeProductId);

  if (!shouldAppendAutomatedPrice(offer.source, trusted)) {
    // Fresh manual report is the authority; still filled null attributes above.
    return true;
  }

  const latest = await rest(
    `prices?store_product_id=eq.${storeProductId}&select=price_cents,created_at&order=created_at.desc&limit=1`,
  );
  if (
    latest?.[0]?.price_cents === offer.priceCents &&
    isPacificToday(latest[0].created_at)
  ) {
    return true;
  }

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
      brand: offer.productBrand ?? null,
      sizeBaseAmount: offer.sizeBaseAmount ?? null,
      sizeBaseUnit: offer.sizeBaseUnit ?? null,
    });
  }

  const externalRef =
    offer.externalRef ??
    `chain:${offer.chainName}|group:${offer.requiresGroup ?? "any"}|${offer.startsAt}|${offer.endsAt}`;

  const buyQty = offer.buyQuantity ?? (offer.discountType === "bogo" ? 1 : null);
  const getQty = offer.getQuantity ?? (offer.discountType === "bogo" ? 1 : null);

  const row = {
    chain_id: chain,
    product_id: productId,
    discount_type: offer.discountType,
    discount_value: offer.discountValue,
    buy_quantity: buyQty,
    get_quantity: getQty,
    label: offer.label ?? null,
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

  // Basket-wide policies only: one row per chain + eligibility group.
  // Product-linked weekly-ad deals must not overwrite each other via this path.
  const isBasketWide = !productId && !offer.productUpc && !offer.productName;
  if (isBasketWide) {
    const groupFilter =
      offer.requiresGroup == null
        ? "requires_group=is.null"
        : `requires_group=eq.${encodeURIComponent(offer.requiresGroup)}`;
    const existing = await rest(
      `promotions?chain_id=eq.${chain}&${groupFilter}&product_id=is.null&select=id&limit=1`,
    );
    if (existing?.[0]?.id) {
      await rest(`promotions?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      return true;
    }
  }

  await rest("promotions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  return true;
}
