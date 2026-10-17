// server.js
import express from "express";

const app = express();

const KROGER_BASE = "https://api.kroger.com/v1";
const { KROGER_CLIENT_ID, KROGER_CLIENT_SECRET } = process.env;

// Cache the token in memory so we don't request a new one on every call
let cachedToken = null;
let tokenExpiresAt = 0; // timestamp in ms

async function getKrogerToken() {
  // Reuse the token if it still has more than 60 seconds left
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  // Basic auth = "client_id:client_secret" encoded as base64
  const basic = Buffer.from(
    `${KROGER_CLIENT_ID}:${KROGER_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${KROGER_BASE}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });

  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000; // expires_in is in seconds
  return cachedToken;
}

// Find stores near a ZIP code
app.get("/api/kroger/locations", async (req, res) => {
  try {
    const token = await getKrogerToken();
    const url = `${KROGER_BASE}/locations?filter.zipCode.near=${req.query.zip}&filter.limit=10`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Search products with prices at one specific store
app.get("/api/kroger/products", async (req, res) => {
  try {
    const token = await getKrogerToken();
    const { term, locationId } = req.query;
    const url =
      `${KROGER_BASE}/products?filter.term=${encodeURIComponent(term)}` +
      `&filter.locationId=${locationId}&filter.limit=20`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => console.log("Proxy running on :3000"));