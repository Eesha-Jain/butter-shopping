const STORE_URL = "https://www.safeway.com/abs/pub/xapi/storeresolver/all";
const PRODUCT_URL = "https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products";

function headers() {
  const extra = {};
  const apim = process.env.SAFEWAY_APIM_KEY;
  if (apim) {
    extra["Ocp-Apim-Subscription-Key"] = apim;
    extra["ocp-apim-subscription-key"] = apim;
  }
  if (process.env.SAFEWAY_COOKIE) {
    extra.Cookie = process.env.SAFEWAY_COOKIE;
  }
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: "https://www.safeway.com",
    Referer: "https://www.safeway.com/shop/search-results.html",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    adrum: "isAjax:true",
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

function pickSafewayImageUrl(product) {
  const candidates = [
    product.imageUrl,
    product.imageURL,
    product.image,
    product.primaryImage,
    product.thumbnail,
    product.smallImageUrl,
    product.mediumImageUrl,
    Array.isArray(product.imageUrls) ? product.imageUrls[0] : null,
    Array.isArray(product.images) ? product.images[0]?.url ?? product.images[0] : null,
  ];
  for (const value of candidates) {
    const url = String(value ?? "").trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function pickSafewayPricePair(product) {
  const regularRaw =
    product.price?.regular ??
    product.price?.basePrice ??
    product.basePrice ??
    product.price?.price ??
    product.price ??
    null;
  const promoRaw =
    product.price?.promo ??
    product.price?.sale ??
    product.price?.offerPrice ??
    product.promoPrice ??
    product.salePrice ??
    product.price?.discount?.price ??
    null;
  const regularCents = dollarsToCents(regularRaw);
  const promoCents = dollarsToCents(promoRaw);
  if (promoCents != null && regularCents != null && promoCents < regularCents) {
    return { priceCents: promoCents, regularPriceCents: regularCents, promoPriceCents: promoCents };
  }
  if (promoCents != null && regularCents == null) {
    return { priceCents: promoCents, regularPriceCents: null, promoPriceCents: promoCents };
  }
  return {
    priceCents: regularCents,
    regularPriceCents: regularCents,
    promoPriceCents: null,
  };
}

export function mapSafewayProduct(product) {
  const prices = pickSafewayPricePair(product);
  return {
    productId: product.pid ?? product.id ?? product.productId ?? null,
    upc: product.upc ?? product.gtin ?? null,
    name: product.name ?? product.description ?? product.title ?? "Unknown product",
    brand: product.brand ?? null,
    size: product.size ?? product.unitOfMeasure ?? null,
    priceCents: prices.priceCents,
    regularPriceCents: prices.regularPriceCents,
    promoPriceCents: prices.promoPriceCents,
    imageUrl: pickSafewayImageUrl(product),
    store: "Safeway",
    source: "scrape",
    productUrl: product.productUrl ?? product.url ?? null,
  };
}

export async function searchSafewayProducts(term, storeId, { rows = 15, start = 0 } = {}) {
  const query = String(term ?? "").trim();
  if (!query) throw new Error("A search term is required.");
  if (!storeId) throw new Error("A Safeway storeId is required.");

  const url = new URL(PRODUCT_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("storeid", String(storeId));
  url.searchParams.set("rows", String(Math.min(90, Math.max(1, rows))));
  url.searchParams.set("start", String(Math.max(0, start)));
  url.searchParams.set("search-type", "keyword");
  url.searchParams.set("channel", "instore");
  url.searchParams.set("banner", "safeway");
  url.searchParams.set("pagename", "search");
  url.searchParams.set("request-id", `${Date.now()}${Math.floor(Math.random() * 1000)}`);

  const res = await fetch(url, { headers: headers() });
  const json = await readJson(res, "Safeway");
  return productLists(json).map(mapSafewayProduct);
}

/**
 * Deep keyword search: paginate Safeway results for one term (deduped by product id/upc).
 */
export async function searchSafewayProductsDeep(
  term,
  storeId,
  { rows = 50, maxPages = 8, delayMs = 250 } = {},
) {
  const byKey = new Map();
  const pageSize = Math.min(90, Math.max(1, rows));
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await searchSafewayProducts(term, storeId, {
      rows: pageSize,
      start: page * pageSize,
    });
    if (!batch.length) break;
    for (const product of batch) {
      if (product.priceCents == null) continue;
      const key = product.upc || product.productId || product.name;
      if (!byKey.has(key)) byKey.set(key, product);
    }
    if (batch.length < pageSize) break;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return [...byKey.values()];
}
