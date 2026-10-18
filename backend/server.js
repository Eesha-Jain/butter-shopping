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
  let persisted = false;
  for (const product of products) {
    try {
      if (await remember(product, store, priceSource, storeSource)) persisted = true;
    } catch {
      // A missed save still returns the price to the caller.
    }
  }
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
  });
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

async function lookupPrices(query, zip, locationId) {
  const offers = [];
  let qfcError = null;
  let fredMeyerError = null;
  let safewayError = null;
  let traderJoesError = null;
  let wrote = false;

  if (zip) {
    try {
      const stores = await findSafewayStores(zip);
      const safewayStore = stores[0];
      if (!safewayStore) throw new Error("No Safeway store was found for that ZIP code.");
      const products = await searchSafewayProducts(query, safewayStore.storeId);
      if (await rememberAll(products, { ...safewayStore, chain: "Safeway" }, "scrape", "safeway")) {
        wrote = true;
      }
      for (const product of products) offers.push(asOffer(product, "Safeway"));
    } catch (error) {
      safewayError = error.message;
    }

    try {
      const stores = await findFredMeyerStores(zip);
      const store = stores[0];
      if (!store) throw new Error("No Fred Meyer store was found for that ZIP code.");
      const products = await searchFredMeyerProducts(query, store.locationId);
      if (await rememberAll(products, { ...store, chain: "Fred Meyer" }, "api", "kroger")) {
        wrote = true;
      }
      for (const product of products) offers.push(asOffer(product, "Fred Meyer"));
    } catch (error) {
      fredMeyerError = error.message;
    }

    try {
      const stores = await findTraderJoesStores(zip);
      const store = stores[0];
      if (!store) throw new Error("No Trader Joe's store was found for that ZIP code.");
      const products = await searchTraderJoesProducts(query, store.storeId);
      if (await rememberAll(products, { ...store, chain: "Trader Joe's" }, "scrape", "trader_joes")) {
        wrote = true;
      }
      for (const product of products) offers.push(asOffer(product, "Trader Joe's"));
    } catch (error) {
      traderJoesError = error.message;
    }
  } else {
    safewayError = "A ZIP code is required to search Safeway.";
    fredMeyerError = "A ZIP code is required to search Fred Meyer.";
    traderJoesError = "A ZIP code is required to search Trader Joe's.";
  }

  try {
    let qfcLocationId = locationId;
    let store = null;
    if (!qfcLocationId && zip) {
      const stores = await findQfcStores(zip);
      store = stores[0] ?? null;
      qfcLocationId = store?.locationId;
    }
    if (!qfcLocationId) throw new Error("No QFC store was found for that ZIP code.");
    const products = await searchQfcProducts(query, qfcLocationId);
    if (store && (await rememberAll(products, { ...store, chain: "QFC" }, "api", "kroger"))) {
      wrote = true;
    }
    for (const product of products) offers.push(asOffer(product, "QFC"));
  } catch (error) {
    qfcError = error.message;
  }

  return {
    offers,
    lowest: lowestOffer(offers),
    qfcError,
    fredMeyerError,
    safewayError,
    traderJoesError,
    canPersist: canPersist(),
    persisted: wrote,
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
      cooledDown: false,
    });
    return;
  }

  const zip = req.query.zip ? String(req.query.zip) : "";
  const cached = readIngestCache(zip, query);
  if (cached) {
    res.status(200).json({ ...cached, cooledDown: true });
    return;
  }

  const body = await lookupPrices(query, zip || null, req.query.locationId);
  writeIngestCache(zip, query, body);
  const status =
    body.offers.length > 0 ||
    (!body.qfcError && !body.safewayError && !body.fredMeyerError && !body.traderJoesError)
      ? 200
      : 502;
  res.status(status).json(body);
});

/**
 * Ingest by barcode: search QFC with the UPC as the term, persist, optional OFF enrich.
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

    let existing = await fetchProductByUpc(upc);
    if (existing) {
      res.json({ product: existing, persisted: false, enriched: false });
      return;
    }

    const stores = await findQfcStores(zip);
    const store = stores[0] ?? null;
    if (!store?.locationId) {
      res.status(404).json({ error: "No QFC store found for that ZIP.", product: null });
      return;
    }

    const products = await searchQfcProducts(upc, store.locationId);
    const match =
      products.find((row) => String(row.upc ?? "") === upc) ??
      products.find((row) => String(row.upc ?? "").endsWith(upc)) ??
      products[0] ??
      null;

    if (!match) {
      res.status(404).json({ error: "No product found for that barcode.", product: null });
      return;
    }

    await remember(match, { ...store, chain: "QFC" }, "api", "kroger");
    existing = await fetchProductByUpc(match.upc ?? upc);
    let enriched = false;
    if (existing?.upc) {
      enriched = await enrichProductComposition(existing.upc);
    }
    res.json({ product: existing, persisted: Boolean(existing), enriched });
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

app.listen(3000, () => {
  console.log("Price proxy running on :3000");
});
