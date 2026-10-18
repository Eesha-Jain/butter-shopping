const STORE_URL = "https://www.safeway.com/abs/pub/xapi/storeresolver/all";
const PRODUCT_URL = "https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products";

function headers() {
  const extra = {};
  if (process.env.SAFEWAY_APIM_KEY) {
    extra["Ocp-Apim-Subscription-Key"] = process.env.SAFEWAY_APIM_KEY;
  }
  return {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "butter-shopping/1.0",
    ...extra,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.stores)) return value.stores;
  if (Array.isArray(value?.locations)) return value.locations;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function dollarsToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

async function readJson(res, label) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} refused the request (${res.status}).`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return product data.`);
  }
}

export async function findSafewayStores(zip) {
  if (!/^\d{5}$/.test(String(zip ?? ""))) {
    throw new Error("ZIP code must be 5 digits.");
  }
  const url = `${STORE_URL}?zipcode=${zip}&radius=25&size=10`;
  const res = await fetch(url, { headers: headers() });
  const json = await readJson(res, "Safeway store lookup");
  return asArray(json).map((store) => ({
    storeId: String(store.storeId ?? store.locationId ?? store.id ?? ""),
    name: store.name ?? store.storeName ?? "Safeway",
    chain: "Safeway",
    address: store.address?.line1 ?? store.addressLine1 ?? store.address ?? null,
    city: store.address?.city ?? store.city ?? null,
    region: store.address?.state ?? store.state ?? null,
    postalCode: store.address?.zipCode ?? store.zipCode ?? store.postalCode ?? zip,
    latitude: store.latitude ?? store.lat ?? null,
    longitude: store.longitude ?? store.lng ?? null,
  })).filter((store) => store.storeId);
}

function productLists(json) {
  return [
    json?.products,
    json?.response?.docs,
    json?.primaryProducts,
    json?.items,
    json?.docs,
  ].find(Array.isArray) ?? [];
}

export function mapSafewayProduct(product) {
  const price =
    product.price?.regular ??
    product.price?.price ??
    product.basePrice ??
    product.price ??
    null;
  const cents = dollarsToCents(price);
  return {
    productId: product.pid ?? product.id ?? product.productId ?? null,
    upc: product.upc ?? product.gtin ?? null,
    name: product.name ?? product.description ?? product.title ?? "Unknown product",
    brand: product.brand ?? null,
    size: product.size ?? product.unitOfMeasure ?? null,
    priceCents: cents,
    regularPriceCents: cents,
    promoPriceCents: null,
    store: "Safeway",
    source: "scrape",
    productUrl: product.productUrl ?? product.url ?? null,
  };
}

export async function searchSafewayProducts(term, storeId) {
  const query = String(term ?? "").trim();
  if (!query) throw new Error("A search term is required.");
  if (!storeId) throw new Error("A Safeway storeId is required.");

  const url = new URL(PRODUCT_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("storeid", String(storeId));
  url.searchParams.set("rows", "15");
  url.searchParams.set("start", "0");
  url.searchParams.set("search-type", "keyword");
  url.searchParams.set("channel", "instore");
  url.searchParams.set("banner", "safeway");
  url.searchParams.set("pagename", "search");
  url.searchParams.set("request-id", `${Date.now()}${Math.floor(Math.random() * 1000)}`);

  const res = await fetch(url, { headers: headers() });
  const json = await readJson(res, "Safeway");
  return productLists(json).map(mapSafewayProduct);
}
