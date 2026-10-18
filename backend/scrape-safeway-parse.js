/**
 * One-shot Safeway staple seed via Parse.bot (free tier ~113 credits for 36 terms).
 * Does not wire into live /api/prices — credits burn fast.
 *
 * Requires PARSE_API_KEY in repo-root .env.local (sign up at parse.bot).
 *
 * Usage (from backend/):
 *   node scrape-safeway-parse.js --zip=98195
 *   npm run scrape:safeway:parse
 *
 * Free tier is 5 req/min; default delay is 12.5s between HTTP calls.
 * Full demo-food-terms.json (~278 terms) exceeds the free monthly credit budget.
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { shelfOffer } from "./pipeline/envelope.js";
import { canIngest, ingestShelf } from "./pipeline/ingest.js";
import { assignProductCategories } from "./persist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, "src/backend/.env") });
dotenv.config({ path: path.join(root, ".env.local") });

const PARSE_BASE = "https://api.parse.bot/scraper/e9841e3f-1253-44ee-b374-04495ddf1123";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const zip = arg("zip", "98195");
const termsPath = path.resolve(__dirname, arg("terms", "./staple-terms.json"));
const delayMs = Math.max(0, Number(arg("delay", "12500")) || 12500);
const pageSize = Math.min(30, Math.max(1, Number(arg("pageSize", "30")) || 30));

function dollarsToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function parseApiKey() {
  const key = String(process.env.PARSE_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "PARSE_API_KEY is missing. Sign up at https://parse.bot and add PARSE_API_KEY to .env.local.",
    );
  }
  return key;
}

async function parseGet(endpoint, params) {
  const url = new URL(`${PARSE_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-Key": parseApiKey(),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Parse ${endpoint} returned non-JSON (${res.status}).`);
  }
  if (!res.ok) {
    const message = json?.error ?? json?.message ?? text.slice(0, 200);
    throw new Error(`Parse ${endpoint} failed (${res.status}): ${message}`);
  }
  // Responses are usually { status, data } or the payload itself.
  return json?.data ?? json;
}

function mapParseStore(row, fallbackZip) {
  return {
    storeId: String(row.store_id ?? row.storeId ?? ""),
    name: row.banner ? `${row.banner}` : "Safeway",
    chain: "Safeway",
    address: row.address ?? null,
    city: row.city ?? null,
    region: row.state ?? null,
    postalCode: row.zip_code ?? row.zipCode ?? fallbackZip,
    latitude: row.latitude ?? row.lat ?? null,
    longitude: row.longitude ?? row.lng ?? null,
  };
}

function mapParseProduct(row) {
  const priceCents = dollarsToCents(row.price);
  const regularCents = dollarsToCents(row.base_price ?? row.basePrice ?? row.price);
  const promoCents =
    priceCents != null && regularCents != null && priceCents < regularCents ? priceCents : null;
  return {
    productId: row.product_id ?? row.productId ?? null,
    upc: row.upc ?? row.gtin ?? null,
    name: row.name ?? row.title ?? "Unknown product",
    brand: row.brand ?? null,
    size: row.size ?? null,
    priceCents,
    regularPriceCents: regularCents,
    promoPriceCents: promoCents,
    imageUrl: row.image_url ?? row.imageUrl ?? row.image ?? null,
    available: row.in_stock !== false && row.inStock !== false,
    productUrl: row.product_url ?? row.productUrl ?? row.url ?? null,
  };
}

async function ingestProducts(products, store) {
  let ok = 0;
  let failed = 0;
  for (const product of products) {
    if (product.priceCents == null) continue;
    try {
      await ingestShelf(
        shelfOffer({
          source: "scrape",
          chainName: "Safeway",
          storeSource: "safeway",
          storeRef: store.storeId,
          storeName: store.name,
          address: store.address,
          city: store.city,
          region: store.region,
          postalCode: store.postalCode,
          latitude: store.latitude,
          longitude: store.longitude,
          productName: product.name,
          brand: product.brand,
          upc: product.upc,
          externalRef: product.productId,
          productUrl: product.productUrl,
          priceCents: product.priceCents,
          regularPriceCents: product.regularPriceCents,
          promoPriceCents: product.promoPriceCents,
          imageUrl: product.imageUrl,
          available: product.available,
        }),
      );
      ok += 1;
    } catch (error) {
      failed += 1;
      if (failed <= 8) {
        console.warn(`  ingest fail ${product.name}: ${error.message}`);
      }
    }
  }
  return { ok, failed };
}

async function main() {
  if (!/^\d{5}$/.test(zip)) {
    console.error("ZIP must be 5 digits.");
    process.exit(1);
  }
  if (!canIngest()) {
    console.error(
      "Persist is off. Set EXPO_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    process.exit(1);
  }

  const terms = JSON.parse(fs.readFileSync(termsPath, "utf8"));
  if (!Array.isArray(terms) || terms.length === 0) {
    console.error("No staple terms found at", termsPath);
    process.exit(1);
  }

  const estimatedCredits = 5 + terms.length * 3;
  console.log(`Parse Safeway seed ZIP=${zip}`);
  console.log(`Terms: ${terms.length} from ${termsPath}`);
  console.log(`Delay ${delayMs}ms between calls (~5 req/min free tier)`);
  console.log(`Estimated credits: ~${estimatedCredits} (free tier = 200/mo)`);
  if (estimatedCredits > 200) {
    console.warn("Warning: this run may exceed the free monthly credit budget.");
  }

  parseApiKey();

  console.log("\n=== find_stores ===");
  const storesPayload = await parseGet("find_stores", { zip_code: zip });
  const storesRaw = Array.isArray(storesPayload?.stores)
    ? storesPayload.stores
    : Array.isArray(storesPayload)
      ? storesPayload
      : [];
  const store = storesRaw.map((row) => mapParseStore(row, zip)).find((row) => row.storeId);
  if (!store) {
    console.error("No Safeway store returned for that ZIP.");
    process.exit(1);
  }
  console.log(`Store ${store.storeId} ${store.name} (${store.city ?? zip})`);
  if (delayMs > 0) await sleep(delayMs);

  const byKey = new Map();
  let termOk = 0;
  let termFail = 0;

  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i];
    try {
      const payload = await parseGet("search_products", {
        query: term,
        store_id: store.storeId,
        page: 1,
        page_size: pageSize,
      });
      const rows = Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload)
          ? payload
          : [];
      let added = 0;
      for (const row of rows) {
        const product = mapParseProduct(row);
        if (product.priceCents == null) continue;
        const key = product.upc || product.productId || product.name;
        if (!byKey.has(key)) {
          byKey.set(key, product);
          added += 1;
        }
      }
      termOk += 1;
      console.log(`  term ${i + 1}/${terms.length} "${term}": +${added} (unique ${byKey.size})`);
    } catch (error) {
      termFail += 1;
      console.warn(`  term ${i + 1}/${terms.length} "${term}" failed: ${error.message}`);
    }
    if (i < terms.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  const products = [...byKey.values()];
  console.log(`\nFetched ${products.length} unique priced Safeway products. Ingesting…`);
  const result = await ingestProducts(products, store);

  try {
    const assigned = await assignProductCategories();
    console.log(`Categories: updated ${assigned.updated ?? 0}`);
  } catch (error) {
    console.warn("Category assignment skipped:", error.message);
  }

  console.log("\nParse Safeway seed finished.");
  console.log(`  terms: ok=${termOk} failed=${termFail}`);
  console.log(`  ingest: ok=${result.ok} failed=${result.failed}`);
  if (result.ok === 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
