import { categoryForProductName } from './category-map.js';

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

async function rest(path, options = {}) {
  const config = supabaseConfig();
  if (!config) return null;
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Could not save the price (${res.status}).`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Active product row by UPC, or null. */
export async function fetchProductByUpc(upc) {
  if (!canPersist()) return null;
  const code = String(upc ?? '').trim();
  if (!code) return null;
  const rows = await rest(
    `products?upc=eq.${encodeURIComponent(code)}&is_active=eq.true&select=*&limit=1`,
  );
  return rows?.[0] ?? null;
}

/**
 * Sets category_id on active products that still have none, using the keyword map.
 * Returns { updated, byCategory }.
 */
export async function assignProductCategories() {
  if (!canPersist()) throw new Error('Persist is not configured.');
  const categories = await rest('product_categories?parent_id=is.null&select=id,name');
  const byName = new Map((categories ?? []).map((row) => [String(row.name).toLowerCase(), row.id]));
  const products = await rest(
    'products?category_id=is.null&is_active=eq.true&select=id,name&limit=1000',
  );
  const byCategory = {};
  let updated = 0;
  const queue = [...(products ?? [])];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const product = queue.shift();
      if (!product) return;
      const categoryName = categoryForProductName(product.name);
      const categoryId = byName.get(String(categoryName).toLowerCase());
      if (!categoryId) continue;
      await rest(`products?id=eq.${product.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ category_id: categoryId }),
      });
      byCategory[categoryName] = (byCategory[categoryName] ?? 0) + 1;
      updated += 1;
    }
  });
  await Promise.all(workers);
  return { updated, byCategory };
}

/** Best-effort Open Food Facts trait sync via Edge Function (service role). */
export async function enrichProductComposition(upc) {
  const config = supabaseConfig();
  const code = String(upc ?? '').trim();
  if (!config || !code) return false;
  try {
    const res = await fetch(`${config.url}/functions/v1/sync-product-composition`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ upc: code }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function chainId(name) {
  const rows = await rest(`chains?name=eq.${encodeURIComponent(name)}&select=id&limit=1`);
  return rows?.[0]?.id ?? null;
}

/** Full product row when a UPC or name+brand match exists. */
async function findProduct(observation) {
  if (observation.upc) {
    const rows = await rest(
      `products?upc=eq.${encodeURIComponent(observation.upc)}&select=*&limit=1`,
    );
    if (rows?.[0]) return rows[0];
  }
  const name = encodeURIComponent(observation.productName);
  const rows = await rest(`products?name=eq.${name}&select=*&limit=20`);
  const brand = String(observation.brand ?? '');
  return (rows ?? []).find((row) => String(row.brand ?? '') === brand) ?? null;
}

function absoluteImageUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Patch an existing catalog product with better retailer fields.
 * Fills blanks; replaces image_path when a new absolute URL is available.
 */
async function updateExistingProduct(existing, observation, imageUrl) {
  const patch = {};
  if (imageUrl && existing.image_path !== imageUrl) {
    patch.image_path = imageUrl;
  }
  if (!existing.brand && observation.brand) {
    patch.brand = observation.brand;
  }
  if (!existing.upc && observation.upc) {
    patch.upc = observation.upc;
  }
  const nextName = String(observation.productName ?? '').trim();
  if (nextName && (!existing.name || existing.name.length < nextName.length)) {
    patch.name = nextName;
  }
  if (Object.keys(patch).length === 0) return existing.id;
  await rest(`products?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  return existing.id;
}

export function canPersist() {
  return supabaseConfig() !== null;
}

/**
 * Upserts store + product listing, refreshes product fields when the SKU
 * already exists, and appends a price observation when cents changed.
 * Returns false when the service-role key is not configured.
 */
export async function saveObservedPrice(observation) {
  if (!canPersist()) return false;
  if (!Number.isInteger(observation.priceCents) || observation.priceCents < 0) return false;

  const chain = await chainId(observation.chainName);
  if (!chain) throw new Error(`Chain ${observation.chainName} is not in the database yet.`);

  const stores = await rest('stores?on_conflict=source,source_ref', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      name: observation.storeName,
      chain_id: chain,
      address_line1: observation.address,
      city: observation.city,
      region: observation.region,
      postal_code: observation.postalCode,
      latitude: observation.latitude,
      longitude: observation.longitude,
      source: observation.storeSource,
      source_ref: observation.storeRef,
    }),
  });
  const storeId = stores?.[0]?.id;
  if (!storeId) throw new Error('Store save did not return a row.');

  const imageUrl = absoluteImageUrl(observation.imageUrl);
  const existing = await findProduct(observation);
  let productId = existing?.id ?? null;

  if (!productId) {
    const created = await rest('products', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name: observation.productName,
        brand: observation.brand,
        upc: observation.upc,
        ...(imageUrl ? { image_path: imageUrl } : {}),
      }),
    });
    productId = created?.[0]?.id;
  } else {
    productId = await updateExistingProduct(existing, observation, imageUrl);
  }
  if (!productId) throw new Error('Product save did not return a row.');

  // Upsert listing so sku/url/availability refresh on every sighting.
  const listings = await rest('store_products?on_conflict=store_id,product_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      store_id: storeId,
      product_id: productId,
      store_sku: observation.productRef,
      product_url: observation.productUrl,
      is_available: true,
    }),
  });
  const storeProductId = listings?.[0]?.id;
  if (!storeProductId) throw new Error('Listing save did not return a row.');

  // Prices are append-only: write a new observation when cents changed.
  const latest = await rest(
    `prices?store_product_id=eq.${storeProductId}&select=price_cents&order=created_at.desc&limit=1`,
  );
  if (latest?.[0]?.price_cents === observation.priceCents) return true;

  await rest('prices', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      store_product_id: storeProductId,
      price_cents: observation.priceCents,
      source: observation.priceSource,
    }),
  });
  return true;
}
