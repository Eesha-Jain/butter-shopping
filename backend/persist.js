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
  const pantryId = byName.get('pantry') ?? null;
  const otherId = byName.get('other') ?? null;

  // Null category_id, plus Pantry rows that should move to Other (non-food keywords / unmatched).
  const [uncategorized, pantryRows] = await Promise.all([
    rest('products?category_id=is.null&is_active=eq.true&select=id,name,category_id&limit=1000'),
    pantryId
      ? rest(
          `products?category_id=eq.${pantryId}&is_active=eq.true&select=id,name,category_id&limit=1000`,
        )
      : Promise.resolve([]),
  ]);

  const seen = new Set();
  const queue = [];
  for (const product of [...(uncategorized ?? []), ...(pantryRows ?? [])]) {
    if (!product?.id || seen.has(product.id)) continue;
    seen.add(product.id);
    queue.push(product);
  }

  const byCategory = {};
  let updated = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const product = queue.shift();
      if (!product) return;
      const categoryName = categoryForProductName(product.name);
      const categoryId = byName.get(String(categoryName).toLowerCase());
      if (!categoryId) continue;
      // Only reclassify Pantry → Other (or null → mapped). Leave correct Pantry food alone.
      if (product.category_id === pantryId && categoryId !== otherId) continue;
      if (product.category_id === categoryId) continue;
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

function isStoragePath(value) {
  return typeof value === 'string' && value.length > 0 && !/^https?:\/\//i.test(value.trim());
}

function extensionFromContentType(contentType, fallbackUrl) {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  const fromUrl = String(fallbackUrl ?? '').match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
  if (fromUrl) return fromUrl[1].toLowerCase().replace('jpeg', 'jpg');
  return 'jpg';
}

/**
 * Downloads a retailer image and uploads it to the public-assets bucket.
 * Returns a relative storage path, or null on failure.
 */
async function storeProductImage(imageUrl, observation) {
  const config = supabaseConfig();
  const source = absoluteImageUrl(imageUrl);
  if (!config || !source) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(source, {
      signal: controller.signal,
      headers: { Accept: 'image/*,*/*', 'User-Agent': 'butter-shopping/1.0' },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > 2 * 1024 * 1024) return null;

    const ext = extensionFromContentType(res.headers.get('content-type'), source);
    const stem = String(observation.upc || observation.productRef || observation.productName || 'product')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    const path = `products/${stem || 'product'}.${ext}`;
    const contentType = res.headers.get('content-type') || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    const upload = await fetch(
      `${config.url}/storage/v1/object/public-assets/${path}?upsert=true`,
      {
        method: 'POST',
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: buffer,
      },
    );
    if (!upload.ok) return null;
    return path;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveImagePath(observation, existingPath) {
  const sourceUrl = absoluteImageUrl(observation.imageUrl);
  const needsUpload =
    Boolean(sourceUrl) && (!existingPath || !isStoragePath(existingPath) || absoluteImageUrl(existingPath));
  if (!needsUpload) return isStoragePath(existingPath) ? existingPath : null;
  const uploaded = await storeProductImage(sourceUrl, observation);
  if (uploaded) return uploaded;
  return isStoragePath(existingPath) ? existingPath : null;
}

async function categoryIdForName(productName) {
  const categoryName = categoryForProductName(productName);
  if (!categoryName) return null;
  const rows = await rest(
    `product_categories?name=eq.${encodeURIComponent(categoryName)}&select=id&limit=1`,
  );
  return rows?.[0]?.id ?? null;
}

/**
 * Patch an existing catalog product with better retailer fields.
 * Fills blanks; replaces image_path when a storage path is available.
 */
async function updateExistingProduct(existing, observation, imagePath) {
  const patch = {};
  if (imagePath && existing.image_path !== imagePath) {
    patch.image_path = imagePath;
  }
  if (!existing.brand && observation.brand) {
    patch.brand = observation.brand;
  }
  if (!existing.upc && observation.upc) {
    patch.upc = observation.upc;
  }
  if (!existing.category_id) {
    const categoryId = await categoryIdForName(observation.productName);
    if (categoryId) patch.category_id = categoryId;
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

  const existing = await findProduct(observation);
  let productId = existing?.id ?? null;
  const imagePath = await resolveImagePath(observation, existing?.image_path ?? null);

  if (!productId) {
    const categoryId = await categoryIdForName(observation.productName);
    const created = await rest('products', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name: observation.productName,
        brand: observation.brand,
        upc: observation.upc,
        ...(imagePath ? { image_path: imagePath } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
      }),
    });
    productId = created?.[0]?.id;
  } else {
    productId = await updateExistingProduct(existing, observation, imagePath);
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
