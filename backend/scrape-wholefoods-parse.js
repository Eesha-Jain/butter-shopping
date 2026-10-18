/**
 * One-shot Whole Foods staple seed via Parse.bot.
 * Free tier: search_products = 5 credits; find_stores = 3.
 * 36 staples ≈ 3 + 36×5 = 183 credits (fits 200/mo free).
 *
 * Does not wire into live /api/prices — credits burn fast.
 * Requires PARSE_API_KEY in repo-root .env.local (sign up at parse.bot).
 *
 * Usage (from backend/):
 *   node scrape-wholefoods-parse.js --zip=98195
 *   npm run scrape:wholefoods:parse
 *
 * Docs: https://parse.bot/marketplace/a5eca994-e76f-416b-a6bb-23ffeaadc358/wholefoodsmarket-com-api
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

const PARSE_BASE = "https://api.parse.bot/scraper/51e4baf2-1a29-4eda-a2b1-d52afdac2133";
const CHAIN_NAME = "Whole Foods Market";

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
const limit = Math.min(30, Math.max(1, Number(arg("limit", "30")) || 30));

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
  return json?.data ?? json;
}

function mapParseStore(row, fallbackZip) {
  const address =
    typeof row.address === "string"
      ? row.address
      : row.address?.line1 ?? row.address?.addressLine1 ?? row.street ?? null;
  const coords = row.coordinates ?? row.geolocation ?? {};
  return {
    storeId: String(row.store_id ?? row.storeId ?? row.id ?? ""),
    name: row.name ?? CHAIN_NAME,
    chain: CHAIN_NAME,
    address,
    city: row.city ?? row.address?.city ?? null,
    region: row.state ?? row.region ?? row.address?.state ?? null,
    postalCode: row.zip_code ?? row.zipCode ?? row.postal_code ?? fallbackZip,
    latitude: coords.latitude ?? coords.lat ?? row.latitude ?? null,
    longitude: coords.longitude ?? coords.lng ?? row.longitude ?? null,
  };
}

function mapParseProduct(row) {
  const priceCents = dollarsToCents(row.price_current ?? row.price);
  const regularCents = dollarsToCents(
    row.price_original ?? row.base_price ?? row.price_current ?? row.price,
  );
  const promoCents =
    priceCents != null && regularCents != null && priceCents < regularCents ? priceCents : null;
  const available =
    row.availability == null ||
    String(row.availability).toLowerCase().includes("in_stock") ||
    String(row.availability).toLowerCase() === "in stock" ||
    row.in_stock === true;
  return {
    productId: row.product_id ?? row.productId ?? row.asin ?? null,
    upc: row.upc ?? row.gtin ?? null,
    name: row.name ?? row.title ?? "Unknown product",
    brand: row.brand ?? null,
    size: row.size_display ?? row.size ?? null,
    priceCents,
    regularPriceCents: regularCents,
    promoPriceCents: promoCents,
    imageUrl: row.image_url ?? row.imageUrl ?? row.image ?? null,
    available,
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
          chainName: CHAIN_NAME,
          storeSource: "whole_foods",
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

  const estimatedCredits = 3 + terms.length * 5;
  console.log(`Parse Whole Foods seed ZIP=${zip}`);
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
    : Array.isArray(storesPayload?.results)
      ? storesPayload.results
      : Array.isArray(storesPayload)
        ? storesPayload
        : [];
  let store = storesRaw.map((row) => mapParseStore(row, zip)).find((row) => row.storeId);
  if (!store) {
    // search_products can resolve store from ZIP alone; use ZIP as storeRef fallback.
    console.warn("No store row from find_stores; ingesting with ZIP as storeRef.");
    store = {
      storeId: zip,
      name: CHAIN_NAME,
      chain: CHAIN_NAME,
      address: null,
      city: null,
      region: null,
      postalCode: zip,
      latitude: null,
      longitude: null,
    };
  } else {
    console.log(`Store ${store.storeId} ${store.name} (${store.city ?? zip})`);
  }
  if (delayMs > 0) await sleep(delayMs);

  const byKey = new Map();
  let termOk = 0;
  let termFail = 0;

  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i];
    try {
      const payload = await parseGet("search_products", {
        query: term,
        zip_code: zip,
        limit,
      });
      const rows = Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.products)
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
  console.log(`\nFetched ${products.length} unique priced Whole Foods products. Ingesting…`);
  const result = await ingestProducts(products, store);

  try {
    const assigned = await assignProductCategories();
    console.log(`Categories: updated ${assigned.updated ?? 0}`);
  } catch (error) {
    console.warn("Category assignment skipped:", error.message);
  }

  console.log("\nParse Whole Foods seed finished.");
  console.log(`  terms: ok=${termOk} failed=${termFail}`);
  console.log(`  ingest: ok=${result.ok} failed=${result.failed}`);
  if (result.ok === 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
