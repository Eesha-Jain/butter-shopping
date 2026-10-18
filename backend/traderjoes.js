const GRAPHQL_URL = "https://www.traderjoes.com/api/graphql";

/** Proven public catalog query used by community TJ price trackers. */
const SEARCH_PRODUCTS_QUERY = `
query SearchProducts($pageSize: Int, $currentPage: Int, $storeCode: String, $published: String = "1") {
  products(
    filter: { store_code: { eq: $storeCode }, published: { eq: $published } }
    pageSize: $pageSize
    currentPage: $currentPage
  ) {
    items {
      sku
      item_title
      name
      retail_price
      availability
      url_key
      primary_image
      primary_image_meta { url }
      price_range {
        minimum_price {
          final_price {
            value
          }
        }
      }
    }
    total_count
    page_info {
      total_pages
    }
  }
}
`;

function headers() {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: "https://www.traderjoes.com",
    Referer: "https://www.traderjoes.com/home/products/category/food-8",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

function dollarsToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

async function graphql(operationName, query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ operationName, query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Trader Joe's refused the request (${res.status}).`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Trader Joe's did not return product data.");
  }
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "Trader Joe's GraphQL error.");
  }
  return json.data;
}

function assertZip(zip) {
  if (!/^\d{5}$/.test(String(zip ?? ""))) {
    throw new Error("ZIP code must be 5 digits.");
  }
}

/**
 * Trader Joe's does not expose a stable public ZIP locator in the same GraphQL
 * surface as products. Use a Seattle-area store code keyed by ZIP prefix, with
 * a default WA store for other Washington ZIPs.
 */
export async function findTraderJoesStores(zip) {
  assertZip(zip);
  const prefix = String(zip).slice(0, 3);
  const seattleCodes = {
    981: "151",
    980: "143",
    982: "117",
  };
  const storeId = seattleCodes[prefix] ?? "151";
  return [
    {
      storeId,
      locationId: storeId,
      name: "Trader Joe's",
      chain: "Trader Joe's",
      address: null,
      city: null,
      region: "WA",
      postalCode: zip,
      latitude: null,
      longitude: null,
    },
  ];
}

function traderJoesImageUrl(path) {
  const raw = String(path ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://www.traderjoes.com${raw}`;
  return null;
}

/** Trader Joe's uses "1" when the store stocks the item and "0" when it does not. */
function traderJoesInStock(availability) {
  return String(availability ?? "1").trim() === "1";
}

function productPriceCents(product) {
  const fromRange = product?.price_range?.minimum_price?.final_price?.value;
  return dollarsToCents(product?.retail_price ?? fromRange);
}

export function mapTraderJoesProduct(product) {
  const sku = product.sku ?? null;
  const urlKey = product.url_key ?? null;
  return {
    productId: sku,
    upc: null,
    name: product.item_title ?? product.name ?? "Unknown product",
    brand: "Trader Joe's",
    size: null,
    priceCents: productPriceCents(product),
    regularPriceCents: productPriceCents(product),
    promoPriceCents: null,
    imageUrl: traderJoesImageUrl(product.primary_image ?? product.primary_image_meta?.url),
    available: traderJoesInStock(product.availability),
    store: "Trader Joe's",
    source: "scrape",
    productUrl: urlKey
      ? `https://www.traderjoes.com/home/products/pdp/${urlKey}`
      : sku
        ? `https://www.traderjoes.com/home/products/pdp/${sku}`
        : null,
  };
}

function matchesTerm(product, term) {
  const title = String(product.item_title ?? product.name ?? "").toLowerCase();
  const parts = term.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.every((part) => title.includes(part));
}

/**
 * Searches published products at one Trader Joe's store via the public GraphQL API.
 * Pages until matches are found or a small page budget is exhausted.
 */
export async function searchTraderJoesProducts(term, storeCode) {
  const query = String(term ?? "").trim();
  if (!query) throw new Error("A search term is required.");
  if (!storeCode) throw new Error("A Trader Joe's store code is required.");

  const matches = [];
  const maxPages = 5;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await graphql("SearchProducts", SEARCH_PRODUCTS_QUERY, {
      storeCode: String(storeCode),
      published: "1",
      currentPage: page,
      pageSize: 50,
    });
    const items = data?.products?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) break;
    for (const item of items) {
      if (matchesTerm(item, query)) matches.push(item);
    }
    if (matches.length >= 20) break;
    const totalPages = data?.products?.page_info?.total_pages ?? page;
    if (page >= totalPages) break;
  }

  return matches.map(mapTraderJoesProduct).filter((product) => product.priceCents != null);
}

/**
 * Pages the full published Trader Joe's catalog for one store code.
 * Optional onPage(page, items, totalPages) for progress.
 */
export async function listAllTraderJoesProducts(storeCode, { onPage, pageSize = 50 } = {}) {
  if (!storeCode) throw new Error("A Trader Joe's store code is required.");
  const size = Math.min(100, Math.max(1, Number(pageSize) || 50));
  const bySku = new Map();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await graphql("SearchProducts", SEARCH_PRODUCTS_QUERY, {
      storeCode: String(storeCode),
      published: "1",
      currentPage: page,
      pageSize: size,
    });
    const items = data?.products?.items ?? [];
    totalPages = Number(data?.products?.page_info?.total_pages) || page;
    if (typeof onPage === "function") onPage(page, items, totalPages);
    if (!Array.isArray(items) || items.length === 0) break;
    for (const item of items) {
      const mapped = mapTraderJoesProduct(item);
      if (mapped.priceCents == null) continue;
      const key = mapped.productId ?? mapped.name;
      if (!bySku.has(key)) bySku.set(key, mapped);
    }
    if (page >= totalPages) break;
    page += 1;
  }

  return [...bySku.values()];
}
