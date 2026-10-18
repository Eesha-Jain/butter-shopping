/**
 * Compatibility wrapper around the unified offer pipeline.
 * Collectors should prefer pipeline/envelope.js + ingestShelf directly.
 */

import { categoryForProductName } from "./category-map.js";
import { canonicalizeUpc, upcLookupValues } from "./lib/product-identity.js";
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

/** Active product row by UPC, or null. */
export async function fetchProductByUpc(upc) {
  if (!canPersist()) return null;
  const canon = canonicalizeUpc(upc);
  if (canon) {
    const byCanon = await rest(
      `products?canonical_upc=eq.${encodeURIComponent(canon)}&is_active=eq.true&select=*&limit=1`,
    );
    if (byCanon?.[0]) return byCanon[0];
  }
  const values = upcLookupValues(upc);
  if (values.length === 0) return null;
  const list = values.map(encodeURIComponent).join(",");
  const rows = await rest(`products?upc=in.(${list})&is_active=eq.true&select=*&limit=1`);
  return rows?.[0] ?? null;
}

/**
 * Sets category_id on active products that still have none, using the keyword map.
 * Also reclassifies:
 * - Pantry → Other (non-food keywords)
 * - Fruits / Vegetables / Produce → Snacks, Beverages, or Other when the map disagrees
 *   (e.g. avocado chips, mango smoothie, Banana Boat sunscreen), skipping category_source=manual.
 * Returns { updated, byCategory }.
 */
export async function assignProductCategories() {
  if (!canPersist()) throw new Error("Persist is not configured.");
  const categories = await rest("product_categories?select=id,name");
  const byName = new Map((categories ?? []).map((row) => [String(row.name).toLowerCase(), row.id]));
  const pantryId = byName.get("pantry") ?? null;
  const otherId = byName.get("other") ?? null;
  const snacksId = byName.get("snacks") ?? null;
  const beveragesId = byName.get("beverages") ?? null;
  const produceFamilyIds = ["fruits", "vegetables", "produce"]
    .map((name) => byName.get(name))
    .filter(Boolean);

  const select = "id,name,category_id,category_source";
  // Null category_id, Pantry → Other candidates, and produce-family rows that may be snacks/drinks/sunscreen.
  const [uncategorized, pantryRows, ...produceBatches] = await Promise.all([
    rest(`products?category_id=is.null&is_active=eq.true&select=${select}&limit=1000`),
    pantryId
      ? rest(
          `products?category_id=eq.${pantryId}&is_active=eq.true&select=${select}&limit=1000`,
        )
      : Promise.resolve([]),
    ...produceFamilyIds.map((id) =>
      rest(`products?category_id=eq.${id}&is_active=eq.true&select=${select}&limit=1000`),
    ),
  ]);

  const seen = new Set();
  const queue = [];
  for (const product of [
    ...(uncategorized ?? []),
    ...(pantryRows ?? []),
    ...produceBatches.flatMap((batch) => batch ?? []),
  ]) {
    if (!product?.id || seen.has(product.id)) continue;
    seen.add(product.id);
    queue.push(product);
  }

  const byCategory = {};
  let updated = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const product = queue.shift();
      if (!product) return;
      if (product.category_source === "manual") continue;
      const categoryName = categoryForProductName(product.name);
      const categoryId = byName.get(String(categoryName).toLowerCase());
      if (!categoryId) continue;
      const inProduceFamily = produceFamilyIds.includes(product.category_id);
      // Pantry → only Other; produce family → Snacks / Beverages / Other; null → any mapped.
      if (product.category_id === pantryId && categoryId !== otherId) continue;
      if (
        inProduceFamily &&
        categoryId !== otherId &&
        categoryId !== snacksId &&
        categoryId !== beveragesId
      ) {
        continue;
      }
      if (product.category_id === categoryId) continue;
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
          imageUrl: observation.imageUrl,
          available: observation.available,
          observedAt: observation.observedAt,
        });
  return ingestShelf(envelope);
}
