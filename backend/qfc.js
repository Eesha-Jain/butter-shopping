const KROGER_BASE = "https://api.kroger.com/v1";

let cachedToken = null;
let tokenExpiresAt = 0;

function dollarsToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

async function getKrogerToken() {
  const { KROGER_CLIENT_ID, KROGER_CLIENT_SECRET } = process.env;
  if (!KROGER_CLIENT_ID || !KROGER_CLIENT_SECRET) {
    throw new Error("Kroger credentials are not configured on the server.");
  }
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const basic = Buffer.from(`${KROGER_CLIENT_ID}:${KROGER_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${KROGER_BASE}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });
  if (!res.ok) throw new Error(`Kroger token request failed: ${res.status}`);

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

export function assertZip(zip) {
  if (!/^\d{5}$/.test(String(zip ?? ""))) {
    throw new Error("ZIP code must be 5 digits.");
  }
}

export function assertTerm(term) {
  const value = String(term ?? "").trim();
  if (!value) throw new Error("A search term is required.");
  if (value.length > 80) throw new Error("Search term is too long.");
  return value;
}

function mapLocation(store) {
  const address = store.address ?? {};
  const geo = store.geolocation ?? {};
  return {
    locationId: store.locationId,
    name: store.name ?? "QFC",
    chain: store.chain ?? "QFC",
    address: address.addressLine1 ?? null,
    city: address.city ?? null,
    region: address.state ?? null,
    postalCode: address.zipCode ?? null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
  };
}

async function krogerGet(path) {
  const token = await getKrogerToken();
  const res = await fetch(`${KROGER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Kroger request failed: ${res.status}`);
  return res.json();
}

export async function findKrogerStores(zip, chain = "QFC") {
  assertZip(zip);
  const json = await krogerGet(
    `/locations?filter.chain=${encodeURIComponent(chain)}` +
      `&filter.zipCode.near=${zip}&filter.radiusInMiles=25&filter.limit=20`,
  );
  return (json.data ?? [])
    .filter((store) => String(store.chain ?? chain).toUpperCase() === chain.toUpperCase())
    .map(mapLocation);
}

export async function findQfcStores(zip) {
  return findKrogerStores(zip, "QFC");
}

export async function krogerLocationsRaw(zip, chain) {
  assertZip(zip);
  const chainQuery = chain ? `&filter.chain=${encodeURIComponent(chain)}` : "";
  return krogerGet(`/locations?filter.zipCode.near=${zip}&filter.limit=10${chainQuery}`);
}

export async function krogerProductsRaw(term, locationId) {
  const query = assertTerm(term);
  if (!locationId) throw new Error("A locationId is required.");
  return krogerGet(
    `/products?filter.term=${encodeURIComponent(query)}` +
      `&filter.locationId=${encodeURIComponent(locationId)}&filter.limit=20`,
  );
}

export function mapQfcProduct(product) {
  const item = product.items?.[0];
  const regular = dollarsToCents(item?.price?.regular);
  const promoRaw = dollarsToCents(item?.price?.promo);
  const promo = promoRaw && promoRaw > 0 ? promoRaw : null;
  return {
    productId: product.productId ?? null,
    upc: product.upc ?? null,
    name: product.description ?? "Unknown product",
    brand: product.brand ?? null,
    size: item?.size ?? null,
    priceCents: promo ?? regular,
    regularPriceCents: regular,
    promoPriceCents: promo,
    store: "QFC",
    source: "api",
  };
}

export async function searchQfcProducts(term, locationId) {
  const json = await krogerProductsRaw(term, locationId);
  return (json.data ?? []).map(mapQfcProduct);
}
