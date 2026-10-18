/**
 * Compatibility wrapper around the unified offer pipeline.
 * Collectors should prefer pipeline/envelope.js + ingestShelf directly.
 */

import { categoryForProductName } from "./category-map.js";
import { shelfOffer } from "./pipeline/envelope.js";
import { canIngest, ingestShelf } from "./pipeline/ingest.js";

export function canPersist() {
  return canIngest();
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
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
    throw new Error(`Could not save the price (${res.status}).`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Digits-only UPC variants so padded barcodes still resolve. */
function upcLookupValues(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const stripped = digits.replace(/^0+/, "") || "0";
  return [...new Set([digits, stripped, stripped.padStart(12, "0"), stripped.padStart(13, "0")])];
}

/** Active product row by UPC, or null. */
export async function fetchProductByUpc(upc) {
  if (!canPersist()) return null;
  const values = upcLookupValues(upc);
  if (values.length === 0) return null;
  const list = values.map(encodeURIComponent).join(",");
  const rows = await rest(`products?upc=in.(${list})&is_active=eq.true&select=*&limit=1`);
  return rows?.[0] ?? null;
}

/**
 * Sets category_id on active products that still have none, using the keyword map.
 * Returns { updated, byCategory }.
 */
export async function assignProductCategories() {
  if (!canPersist()) throw new Error("Persist is not configured.");
  const categories = await rest("product_categories?select=id,name");
  const byName = new Map((categories ?? []).map((row) => [String(row.name).toLowerCase(), row.id]));
  const products = await rest(
    "products?category_id=is.null&is_active=eq.true&select=id,name&limit=1000",
  );
  const byCategory = {};
  let updated = 0;
  const queue = [...(products ?? [])];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const product = queue.shift();
      if (!product) return;
      const categoryName = categoryForProductName(product.name);
      const categoryId = byName.get(String(categoryName).toLowerCase());
      if (!categoryId) continue;
      await rest(`products?id=eq.${product.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ category_id: categoryId, category_source: "keyword" }),
      });
      byCategory[categoryName] = (byCategory[categoryName] ?? 0) + 1;
      updated += 1;
    }
  });
  await Promise.all(workers);
  return { updated, byCategory };
}

/** Best-effort Open Food Facts trait sync via Edge Function (service role). */
export async function enrichProductComposition(upc) {
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

/**
 * Appends an api or scrape price through Validate → Match → write.
 * Accepts the legacy observation shape or a shelf envelope.
 */
export async function saveObservedPrice(observation) {
  const envelope =
    observation.kind === "shelf"
      ? observation
      : shelfOffer({
          source: observation.priceSource ?? observation.source,
          chainName: observation.chainName,
          storeSource: observation.storeSource,
          storeRef: observation.storeRef,
          storeName: observation.storeName,
          address: observation.address,
          city: observation.city,
          region: observation.region,
          postalCode: observation.postalCode,
          latitude: observation.latitude,
          longitude: observation.longitude,
          productName: observation.productName,
          brand: observation.brand,
          upc: observation.upc,
          externalRef: observation.productRef ?? observation.externalRef,
          productUrl: observation.productUrl,
          priceCents: observation.priceCents,
          regularPriceCents: observation.regularPriceCents,
          promoPriceCents: observation.promoPriceCents,
          observedAt: observation.observedAt,
        });
  return ingestShelf(envelope);
}
