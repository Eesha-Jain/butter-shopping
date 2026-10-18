import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import {
  assignProductCategories,
  canPersist,
  enrichProductComposition,
  fetchProductByUpc,
  saveObservedPrice,
} from "./persist.js";
import { shelfOffer } from "./pipeline/envelope.js";
import {
  assertTerm,
  assertZip,
  findFredMeyerStores,
  findQfcStores,
  krogerLocationsRaw,
  krogerProductsRaw,
  searchFredMeyerProducts,
  searchQfcProducts,
} from "./qfc.js";
import { findSafewayStores, searchSafewayProducts } from "./safeway.js";
import { findTraderJoesStores, searchTraderJoesProducts } from "./traderjoes.js";
import { fetchOpenPricesByUpc } from "./open-prices.js";
import { listVisaOffers } from "./visa-offers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, "src/backend/.env") });
dotenv.config({ path: path.join(root, ".env.local") });

const app = express();
app.use(express.json());

const INGEST_COOLDOWN_MS = 5 * 60 * 1000;
/** @type {Map<string, { at: number, body: unknown }>} */
const ingestCache = new Map();

function cacheKey(zip, term) {
  return `${zip ?? ""}:${String(term ?? "")
    .trim()
    .toLowerCase()}`;
}

function readIngestCache(zip, term) {
  const key = cacheKey(zip, term);
  const hit = ingestCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > INGEST_COOLDOWN_MS) {
    ingestCache.delete(key);
    return null;
  }
  return hit.body;
}

function writeIngestCache(zip, term, body) {
  ingestCache.set(cacheKey(zip, term), { at: Date.now(), body });
}

function originAllowed(origin) {
  if (!origin) return true;
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin) ||
    origin.startsWith("exp://")
  );
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

function sendError(res, error) {
  res.status(502).json({ error: error.message ?? "Price lookup failed" });
}

async function remember(product, store, priceSource, storeSource) {
  if (product.priceCents == null) return false;
  return saveObservedPrice(
    shelfOffer({
      source: priceSource,
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
    }),
  );
}

async function rememberAll(products, store, priceSource, storeSource) {
  const CONCURRENCY = 4;
  let persisted = false;
  let cursor = 0;
  async function worker() {
    while (cursor < products.length) {
      const product = products[cursor++];
      try {
        if (await remember(product, store, priceSource, storeSource)) persisted = true;
      } catch {
        // A missed save still returns the price to the caller.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, products.length) }, () => worker()),
  );
  return persisted;
}

function asOffer(product, storeName) {
  return {
    store: storeName,
    name: product.name,
    brand: product.brand ?? null,
    priceCents: product.priceCents ?? null,
    source: product.source,
    productId: product.productId ?? null,
    upc: product.upc ?? null,
  };
}

function lowestOffer(offers) {
  const priced = offers.filter((offer) => Number.isInteger(offer.priceCents));
  if (priced.length === 0) return null;
  return priced.reduce((best, offer) => (offer.priceCents < best.priceCents ? offer : best));
}

const krogerReady = () =>
  Boolean(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET);

app.get("/api/health", (_req, res) => {
  res.json({
    qfc: krogerReady(),
    fredMeyer: krogerReady(),
    safeway: true,
    traderJoes: true,
    persist: canPersist(),
    visa: Boolean(
      process.env.VISA_USER_ID &&
        process.env.VISA_PASSWORD &&
        process.env.VISA_CERT_PATH &&
        process.env.VISA_KEY_PATH,
    ),
    openPrices: true,
  });
});

/**
 * Visa Merchant Offers (VMORC) for grocery chains.
 * Query: merchant (optional filter, e.g. Safeway). Falls back to demo offers
 * when sandbox mTLS credentials are not configured.
 */
app.get("/api/visa/offers", async (req, res) => {
  try {
    const merchant = req.query.merchant ? String(req.query.merchant) : null;
    const result = await listVisaOffers(merchant);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Crowd-sourced prices by barcode (Open Prices / Open Food Facts).
 * Query: upc (required)
 */
app.get("/api/open-prices", async (req, res) => {
  try {
    const upc = String(req.query.upc ?? "").trim();
    const prices = await fetchOpenPricesByUpc(upc);
    res.json({ upc, prices, source: "open_prices" });
  } catch (error) {
    res.status(400).json({ error: error.message ?? "Open Prices lookup failed", prices: [] });
  }
});

app.get("/api/kroger/locations", async (req, res) => {
  try {
    res.json(await krogerLocationsRaw(req.query.zip, req.query.chain));
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/kroger/products", async (req, res) => {
  try {
    res.json(await krogerProductsRaw(req.query.term, req.query.locationId));
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/qfc/locations", async (req, res) => {
  try {
    res.json({ data: await findQfcStores(req.query.zip) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/qfc/products", async (req, res) => {
  try {
    const term = assertTerm(req.query.term);
    let locationId = req.query.locationId;
    let store = null;
    if (!locationId) {
      assertZip(req.query.zip);
      const stores = await findQfcStores(req.query.zip);
      store = stores[0] ?? null;
      locationId = store?.locationId;
      if (!locationId) {
        res.json({ data: [], store: null, persisted: false });
        return;
      }
    }
    const products = await searchQfcProducts(term, locationId);
    const persisted = store
      ? await rememberAll(products, { ...store, chain: "QFC" }, "api", "kroger")
      : false;
    res.json({ data: products, store, persisted });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/fred-meyer/locations", async (req, res) => {
  try {
    res.json({ data: await findFredMeyerStores(req.query.zip) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/fred-meyer/products", async (req, res) => {
  try {
    const term = assertTerm(req.query.term);
    let locationId = req.query.locationId;
    let store = null;
    if (!locationId) {
      assertZip(req.query.zip);
      const stores = await findFredMeyerStores(req.query.zip);
      store = stores[0] ?? null;
      locationId = store?.locationId;
      if (!locationId) {
        res.json({ data: [], store: null, persisted: false });
        return;
      }
    }
    const products = await searchFredMeyerProducts(term, locationId);
    const persisted = store
      ? await rememberAll(products, { ...store, chain: "Fred Meyer" }, "api", "kroger")
      : false;
    res.json({ data: products, store, persisted });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/safeway/locations", async (req, res) => {
  try {
    res.json({ data: await findSafewayStores(req.query.zip) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/safeway/products", async (req, res) => {
  try {
    const term = assertTerm(req.query.term);
    let storeId = req.query.storeId;
    let store = null;
    if (!storeId) {
      const stores = await findSafewayStores(req.query.zip);
      store = stores[0] ?? null;
      storeId = store?.storeId;
    }
    if (!storeId) throw new Error("No Safeway store was found for that ZIP code.");
    const products = await searchSafewayProducts(term, storeId);
    const persisted = store
      ? await rememberAll(products, { ...store, chain: "Safeway" }, "scrape", "safeway")
      : false;
    res.json({ data: products, store, persisted });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/trader-joes/locations", async (req, res) => {
  try {
    res.json({ data: await findTraderJoesStores(req.query.zip) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/trader-joes/products", async (req, res) => {
  try {
    const term = assertTerm(req.query.term);
    let storeId = req.query.storeId;
    let store = null;
    if (!storeId) {
      assertZip(req.query.zip);
      const stores = await findTraderJoesStores(req.query.zip);
      store = stores[0] ?? null;
      storeId = store?.storeId;
    }
    if (!storeId) throw new Error("No Trader Joe's store was found for that ZIP code.");
    const products = await searchTraderJoesProducts(term, storeId);
    const persisted = store
      ? await rememberAll(products, { ...store, chain: "Trader Joe's" }, "scrape", "trader_joes")
      : false;
    res.json({ data: products, store, persisted });
  } catch (error) {
    sendError(res, error);
  }
});

function pickUpcMatch(products, upc) {
  return (
    products.find((row) => String(row.upc ?? "") === upc) ??
    products.find((row) => String(row.upc ?? "").endsWith(upc)) ??
    products.find((row) => upc.endsWith(String(row.upc ?? ""))) ??
    products[0] ??
    null
  );
}

function hasRetailerError(body) {
  return Boolean(body.qfcError || body.safewayError || body.fredMeyerError || body.traderJoesError);
}

/**
 * Run retailer collectors in parallel. Each chain isolates its own errors.
 * @returns {Promise<{ key: string, offers: object[], error: string | null, persisted: boolean }>}
 */
async function runChainCollector(key, fn) {
  try {
    const result = await fn();
    return { key, offers: result.offers ?? [], error: null, persisted: Boolean(result.persisted) };
  } catch (error) {
    return { key, offers: [], error: error.message ?? "Lookup failed", persisted: false };
  }
}

/**
 * @param {string} query
 * @param {string | null} zip
 * @param {string | undefined} locationId
 * @param {Set<string> | null} allowedKeys null = all chains
 */
async function lookupPrices(query, zip, locationId, allowedKeys = null) {
  const want = (key) => !allowedKeys || allowedKeys.has(key);
  const collectors = [];

  if (want("qfc")) collectors.push(
    runChainCollector("qfc", async () => {
      let qfcLocationId = locationId;
      let store = null;
      if (!qfcLocationId && zip) {
        const stores = await findQfcStores(zip);
        store = stores[0] ?? null;
        qfcLocationId = store?.locationId;
      }
      if (!qfcLocationId) throw new Error("No QFC store was found for that ZIP code.");
      if (!store && zip) {
        const stores = await findQfcStores(zip);
        store = stores.find((row) => row.locationId === qfcLocationId) ?? stores[0] ?? null;
      }
      const products = await searchQfcProducts(query, qfcLocationId);
      const persisted = store
        ? await rememberAll(products, { ...store, chain: "QFC" }, "api", "kroger")
        : false;
      return { offers: products.map((product) => asOffer(product, "QFC")), persisted };
    }),
  );

  if (zip) {
    if (want("fredMeyer"))
      collectors.push(
        runChainCollector("fredMeyer", async () => {
          const stores = await findFredMeyerStores(zip);
          const store = stores[0];
          if (!store) throw new Error("No Fred Meyer store was found for that ZIP code.");
          const products = await searchFredMeyerProducts(query, store.locationId);
          const persisted = await rememberAll(
            products,
            { ...store, chain: "Fred Meyer" },
            "api",
            "kroger",
          );
          return {
            offers: products.map((product) => asOffer(product, "Fred Meyer")),
            persisted,
          };
        }),
      );

    if (want("safeway"))
      collectors.push(
        runChainCollector("safeway", async () => {
          const stores = await findSafewayStores(zip);
          const safewayStore = stores[0];
          if (!safewayStore) throw new Error("No Safeway store was found for that ZIP code.");
          const products = await searchSafewayProducts(query, safewayStore.storeId);
          const persisted = await rememberAll(
            products,
            { ...safewayStore, chain: "Safeway" },
            "scrape",
            "safeway",
          );
          return {
            offers: products.map((product) => asOffer(product, "Safeway")),
            persisted,
          };
        }),
      );

    if (want("traderJoes"))
      collectors.push(
        runChainCollector("traderJoes", async () => {
          const stores = await findTraderJoesStores(zip);
          const store = stores[0];
          if (!store) throw new Error("No Trader Joe's store was found for that ZIP code.");
          const products = await searchTraderJoesProducts(query, store.storeId);
          const persisted = await rememberAll(
            products,
            { ...store, chain: "Trader Joe's" },
            "scrape",
            "trader_joes",
          );
          return {
            offers: products.map((product) => asOffer(product, "Trader Joe's")),
            persisted,
          };
        }),
      );
  }

  const results = await Promise.all(collectors);
  const offers = results.flatMap((row) => row.offers);
  const persistedByChain = {
    qfc: false,
    safeway: false,
    fredMeyer: false,
    traderJoes: false,
  };
  for (const row of results) {
    if (row.persisted) persistedByChain[row.key] = true;
  }

  const errorFor = (key) => results.find((row) => row.key === key)?.error ?? null;

  return {
    offers,
    lowest: lowestOffer(offers),
    qfcError: errorFor("qfc"),
    fredMeyerError: zip
      ? errorFor("fredMeyer")
      : "A ZIP code is required to search Fred Meyer.",
    safewayError: zip ? errorFor("safeway") : "A ZIP code is required to search Safeway.",
    traderJoesError: zip
      ? errorFor("traderJoes")
      : "A ZIP code is required to search Trader Joe's.",
    canPersist: canPersist(),
    persisted: Object.values(persistedByChain).some(Boolean),
    persistedByChain,
    cooledDown: false,
  };
}

app.get("/api/prices", async (req, res) => {
  let query = "";
  try {
    query = assertTerm(req.query.term);
  } catch (error) {
    res.status(502).json({
      offers: [],
      lowest: null,
      qfcError: error.message,
      fredMeyerError: error.message,
      safewayError: error.message,
      traderJoesError: error.message,
      persisted: canPersist(),
      persistedByChain: { qfc: false, safeway: false, fredMeyer: false, traderJoes: false },
      cooledDown: false,
    });
    return;
  }

  const zip = req.query.zip ? String(req.query.zip) : "";
  const forceRefresh =
    req.query.refresh === "1" || req.query.refresh === "true" || req.query.fresh === "1";
  /** Optional: comma-separated keys qfc,fredMeyer,safeway,traderJoes */
  const chainsRaw = req.query.chains ? String(req.query.chains) : "";
  const allowedKeys = chainsRaw
    ? new Set(
        chainsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const cacheKey = allowedKeys ? `${query}::${[...allowedKeys].sort().join(",")}` : query;
  const cached = forceRefresh ? null : readIngestCache(zip, cacheKey);
  if (cached) {
    res.status(200).json({ ...cached, cooledDown: true });
    return;
  }

  const body = await lookupPrices(query, zip || null, req.query.locationId, allowedKeys);
  // Do not freeze a partial/failed multi-store result for the full cooldown.
  if (!hasRetailerError(body)) {
    writeIngestCache(zip, cacheKey, body);
  }
  const status =
    body.offers.length > 0 ||
    (!body.qfcError && !body.safewayError && !body.fredMeyerError && !body.traderJoesError)
      ? 200
      : 502;
  res.status(status).json(body);
});

/**
 * Ingest by barcode across QFC, Fred Meyer, and Safeway.
 * Query: upc (required), zip (default 98195)
 */
app.get("/api/products/by-upc", async (req, res) => {
  try {
    const upc = String(req.query.upc ?? "").trim();
    if (!/^\d{8,14}$/.test(upc)) {
      res.status(400).json({ error: "upc must be 8–14 digits.", product: null });
      return;
    }
    const zip = String(req.query.zip ?? "98195");
    assertZip(zip);

    const persistedByChain = { qfc: false, fredMeyer: false, safeway: false };
    let foundAny = false;

    try {
      const stores = await findQfcStores(zip);
      const store = stores[0] ?? null;
      if (store?.locationId) {
        const products = await searchQfcProducts(upc, store.locationId);
        const match = pickUpcMatch(products, upc);
        if (match) {
          foundAny = true;
          if (await remember(match, { ...store, chain: "QFC" }, "api", "kroger")) {
            persistedByChain.qfc = true;
          }
        }
      }
    } catch {
      // Try other chains.
    }

    try {
      const stores = await findFredMeyerStores(zip);
      const store = stores[0] ?? null;
      if (store?.locationId) {
        const products = await searchFredMeyerProducts(upc, store.locationId);
        const match = pickUpcMatch(products, upc);
        if (match) {
          foundAny = true;
          if (await remember(match, { ...store, chain: "Fred Meyer" }, "api", "kroger")) {
            persistedByChain.fredMeyer = true;
          }
        }
      }
    } catch {
      // Try other chains.
    }

    try {
      const stores = await findSafewayStores(zip);
      const store = stores[0] ?? null;
      if (store?.storeId) {
        const products = await searchSafewayProducts(upc, store.storeId);
        const match = pickUpcMatch(products, upc);
        if (match) {
          foundAny = true;
          if (await remember(match, { ...store, chain: "Safeway" }, "scrape", "safeway")) {
            persistedByChain.safeway = true;
          }
        }
      }
    } catch {
      // Fall through to local lookup.
    }

    let existing = await fetchProductByUpc(upc);
    if (!existing && !foundAny) {
      res.status(404).json({ error: "No product found for that barcode.", product: null });
      return;
    }

    let enriched = false;
    if (existing?.upc) {
      enriched = await enrichProductComposition(existing.upc);
    }
    res.json({
      product: existing,
      persisted: Object.values(persistedByChain).some(Boolean),
      persistedByChain,
      enriched,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/admin/assign-categories", async (req, res) => {
  try {
    if (!canPersist()) {
      res.status(503).json({ error: "Persist is not configured." });
      return;
    }
    const result = await assignProductCategories();
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  // On Windows, the listening callback can fire before EADDRINUSE; only log when bound.
  const addr = server.address();
  if (!addr || !server.listening) return;
  const port = typeof addr === "string" ? addr : addr.port;
  console.log(`Price proxy running on :${port}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Kill the other node process (or set PORT=3001).`,
    );
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
