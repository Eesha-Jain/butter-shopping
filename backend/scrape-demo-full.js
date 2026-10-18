/**
 * One-day demo fill: scrape the full Trader Joe's published catalog for a
 * Seattle-area store, plus a deep Safeway food keyword scrape for campus ZIP.
 *
 * Usage (from backend/):
 *   node scrape-demo-full.js
 *   node scrape-demo-full.js --zip=98195 --concurrency=6
 *   node scrape-demo-full.js --only=tj
 *   node scrape-demo-full.js --only=safeway
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { shelfOffer } from "./pipeline/envelope.js";
import { canIngest, ingestShelf } from "./pipeline/ingest.js";
import { assignProductCategories } from "./persist.js";
import { findSafewayStores, searchSafewayProductsDeep } from "./safeway.js";
import { findTraderJoesStores, listAllTraderJoesProducts } from "./traderjoes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, "src/backend/.env") });
dotenv.config({ path: path.join(root, ".env.local") });

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const zip = arg("zip", "98195");
const only = String(arg("only", "all")).toLowerCase();
const concurrency = Math.max(1, Number(arg("concurrency", "5")) || 5);
const delayMs = Math.max(0, Number(arg("delay", "200")) || 200);

function toShelf(product, store, storeSource) {
  return shelfOffer({
    source: "scrape",
    chainName: store.chain,
    storeSource,
    storeRef: store.locationId ?? store.storeId,
    storeName: store.name,
    address: typeof store.address === "string" ? store.address : null,
    city: store.city,
    region: store.region,
    postalCode: store.postalCode,
    latitude: store.latitude,
    longitude: store.longitude,
    productName: product.name,
    brand: product.brand,
    upc: product.upc,
    externalRef: product.productId,
    productUrl: product.productUrl ?? null,
    priceCents: product.priceCents,
    regularPriceCents: product.regularPriceCents ?? null,
    promoPriceCents: product.promoPriceCents ?? null,
    imageUrl: product.imageUrl ?? null,
    available: product.available !== false,
  });
}

async function ingestProducts(products, store, storeSource, label) {
  let ok = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < products.length) {
      const index = cursor++;
      const product = products[index];
      try {
        await ingestShelf(toShelf(product, store, storeSource));
        ok += 1;
      } catch (error) {
        failed += 1;
        if (failed <= 8) {
          console.warn(`  [${label}] fail ${product.name}: ${error.message}`);
        }
      }
      if ((ok + failed) % 50 === 0) {
        console.log(`  [${label}] progress ${ok + failed}/${products.length} (ok=${ok} fail=${failed})`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, () => worker()));
  return { ok, failed };
}

async function scrapeTraderJoes() {
  console.log("\n=== Trader Joe's full catalog ===");
  const stores = await findTraderJoesStores(zip);
  const store = stores[0];
  if (!store) throw new Error("No Trader Joe's store mapped for that ZIP.");
  console.log(`Store code ${store.storeId} (ZIP ${zip})`);

  const products = await listAllTraderJoesProducts(store.storeId, {
    onPage: (page, items, totalPages) => {
      if (page === 1 || page % 5 === 0 || page === totalPages) {
        console.log(`  fetch page ${page}/${totalPages} (${items.length} items)`);
      }
    },
  });
  console.log(`Fetched ${products.length} priced products. Ingesting…`);
  const result = await ingestProducts(products, { ...store, chain: "Trader Joe's" }, "trader_joes", "TJ");
  console.log(`Trader Joe's done: ok=${result.ok} failed=${result.failed}`);
  return result;
}

async function scrapeSafeway() {
  console.log("\n=== Safeway deep food scrape ===");
  const forcedStoreId = arg("store-id", "");
  let store;
  if (forcedStoreId) {
    store = {
      storeId: forcedStoreId,
      name: "Safeway",
      chain: "Safeway",
      address: null,
      city: "Seattle",
      region: "WA",
      postalCode: zip,
      latitude: null,
      longitude: null,
    };
    console.log(`Using --store-id=${forcedStoreId} (skipped store resolver)`);
  } else {
    if (!process.env.SAFEWAY_APIM_KEY) {
      throw new Error(
        "Safeway XAPI needs SAFEWAY_APIM_KEY in .env.local (or pass --store-id=… with a key). Store lookup returned 401 without it.",
      );
    }
    const stores = await findSafewayStores(zip);
    store = stores[0];
    if (!store) throw new Error("No Safeway store was found for that ZIP.");
  }
  console.log(`Store ${store.storeId} ${store.name} (${store.city ?? zip})`);

  const termsPath = path.join(__dirname, "demo-food-terms.json");
  const terms = JSON.parse(fs.readFileSync(termsPath, "utf8"));
  const byKey = new Map();

  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i];
    try {
      const batch = await searchSafewayProductsDeep(term, store.storeId, {
        rows: 50,
        maxPages: 6,
        delayMs: 150,
      });
      let added = 0;
      for (const product of batch) {
        const key = product.upc || product.productId || product.name;
        if (!byKey.has(key)) {
          byKey.set(key, product);
          added += 1;
        }
      }
      console.log(`  term ${i + 1}/${terms.length} "${term}": +${added} (unique ${byKey.size})`);
    } catch (error) {
      console.warn(`  term "${term}" failed: ${error.message}`);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  const products = [...byKey.values()];
  console.log(`Fetched ${products.length} unique priced Safeway products. Ingesting…`);
  const result = await ingestProducts(products, { ...store, chain: "Safeway" }, "safeway", "Safeway");
  console.log(`Safeway done: ok=${result.ok} failed=${result.failed}`);
  return result;
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

  console.log(`Demo scrape ZIP=${zip} concurrency=${concurrency} only=${only}`);
  const runTj = only === "all" || only === "tj" || only === "traderjoes" || only === "trader_joes";
  const runSafeway = only === "all" || only === "safeway";

  const results = [];
  if (runTj) {
    try {
      results.push({ chain: "Trader Joe's", ...(await scrapeTraderJoes()) });
    } catch (error) {
      console.error("Trader Joe's scrape failed:", error.message);
      results.push({ chain: "Trader Joe's", ok: 0, failed: 1, error: error.message });
    }
  }
  if (runSafeway) {
    try {
      results.push({ chain: "Safeway", ...(await scrapeSafeway()) });
    } catch (error) {
      console.error("Safeway scrape failed:", error.message);
      results.push({ chain: "Safeway", ok: 0, failed: 1, error: error.message });
    }
  }

  try {
    const assigned = await assignProductCategories();
    console.log(`\nCategories: updated ${assigned.updated ?? 0}`);
  } catch (error) {
    console.warn("Category assignment skipped:", error.message);
  }

  console.log("\nDemo scrape finished.");
  for (const row of results) {
    console.log(`  ${row.chain}: ok=${row.ok} failed=${row.failed}${row.error ? ` (${row.error})` : ""}`);
  }
  if (results.every((row) => (row.ok ?? 0) === 0)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
