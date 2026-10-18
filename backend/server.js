import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { canPersist, saveObservedPrice } from "./persist.js";
import {
  assertTerm,
  assertZip,
  findQfcStores,
  krogerLocationsRaw,
  krogerProductsRaw,
  searchQfcProducts,
} from "./qfc.js";
import { findSafewayStores, searchSafewayProducts } from "./safeway.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, "src/backend/.env") });
dotenv.config({ path: path.join(root, ".env.local") });

const app = express();

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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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
  return saveObservedPrice({
    chainName: store.chain,
    storeSource,
    priceSource,
    storeRef: store.locationId ?? store.storeId,
    storeName: store.name,
    address: typeof store.address === "string" ? store.address : null,
    city: store.city,
    region: store.region,
    postalCode: store.postalCode,
    latitude: store.latitude,
    longitude: store.longitude,
    productRef: product.productId,
    productName: product.name,
    brand: product.brand,
    upc: product.upc,
    priceCents: product.priceCents,
    productUrl: product.productUrl ?? null,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    qfc: Boolean(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET),
    safeway: true,
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
    const persisted = store ? await rememberAll(products, store, "api", "kroger") : false;
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

app.get("/api/prices", async (req, res) => {
  const offers = [];
  let qfcError = null;
  let safewayError = null;

  let query = "";
  try {
    query = assertTerm(req.query.term);
  } catch (error) {
    res.status(502).json({
      offers: [],
      lowest: null,
      qfcError: error.message,
      safewayError: error.message,
      persisted: canPersist(),
    });
    return;
  }

  if (req.query.zip) {
    try {
      const stores = await findSafewayStores(req.query.zip);
      const safewayStore = stores[0];
      if (!safewayStore) throw new Error("No Safeway store was found for that ZIP code.");
      const products = await searchSafewayProducts(query, safewayStore.storeId);
      await rememberAll(products, { ...safewayStore, chain: "Safeway" }, "scrape", "safeway");
      for (const product of products) offers.push(asOffer(product, "Safeway"));
    } catch (error) {
      safewayError = error.message;
    }
  } else {
    safewayError = "A ZIP code is required to search Safeway.";
  }

  try {
    let locationId = req.query.locationId;
    let store = null;
    if (!locationId && req.query.zip) {
      const stores = await findQfcStores(req.query.zip);
      store = stores[0] ?? null;
      locationId = store?.locationId;
    }
    if (!locationId) throw new Error("No QFC store was found for that ZIP code.");
    const products = await searchQfcProducts(query, locationId);
    if (store) await rememberAll(products, { ...store, chain: "QFC" }, "api", "kroger");
    for (const product of products) offers.push(asOffer(product, "QFC"));
  } catch (error) {
    qfcError = error.message;
  }

  const lowest = lowestOffer(offers);
  const status = offers.length > 0 || (!qfcError && !safewayError) ? 200 : 502;
  res.status(status).json({
    offers,
    lowest,
    qfcError,
    safewayError,
    persisted: canPersist(),
  });
});

app.listen(3000, () => {
  console.log("Price proxy running on :3000");
});
