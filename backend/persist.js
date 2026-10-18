function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(path, options = {}) {
  const config = supabaseConfig();
  if (!config) return null;
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
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

async function chainId(name) {
  const rows = await rest(`chains?name=eq.${encodeURIComponent(name)}&select=id&limit=1`);
  return rows?.[0]?.id ?? null;
}

async function findProduct(observation) {
  if (observation.upc) {
    const rows = await rest(`products?upc=eq.${encodeURIComponent(observation.upc)}&select=id&limit=1`);
    if (rows?.[0]?.id) return rows[0].id;
  }
  const name = encodeURIComponent(observation.productName);
  const rows = await rest(`products?name=eq.${name}&select=id,brand&limit=20`);
  const brand = String(observation.brand ?? "");
  return (rows ?? []).find((row) => String(row.brand ?? "") === brand)?.id ?? null;
}

export function canPersist() {
  return supabaseConfig() !== null;
}

/**
 * Appends an api or scrape price. Skips the insert when the latest cents match.
 * Returns false when the service-role key is not configured.
 */
export async function saveObservedPrice(observation) {
  if (!canPersist()) return false;
  if (!Number.isInteger(observation.priceCents) || observation.priceCents < 0) return false;

  const chain = await chainId(observation.chainName);
  if (!chain) throw new Error(`Chain ${observation.chainName} is not in the database yet.`);

  const stores = await rest("stores?on_conflict=source,source_ref", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
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
  if (!storeId) throw new Error("Store save did not return a row.");

  let productId = await findProduct(observation);
  if (!productId) {
    const created = await rest("products", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: observation.productName,
        brand: observation.brand,
        upc: observation.upc,
      }),
    });
    productId = created?.[0]?.id;
  }
  if (!productId) throw new Error("Product save did not return a row.");

  const listings = await rest("store_products?on_conflict=store_id,product_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      store_id: storeId,
      product_id: productId,
      store_sku: observation.productRef,
      product_url: observation.productUrl,
      is_available: true,
    }),
  });
  const storeProductId = listings?.[0]?.id;
  if (!storeProductId) throw new Error("Listing save did not return a row.");

  const latest = await rest(
    `prices?store_product_id=eq.${storeProductId}&select=price_cents&order=created_at.desc&limit=1`,
  );
  if (latest?.[0]?.price_cents === observation.priceCents) return true;

  await rest("prices", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      store_product_id: storeProductId,
      price_cents: observation.priceCents,
      source: observation.priceSource,
    }),
  });
  return true;
}
