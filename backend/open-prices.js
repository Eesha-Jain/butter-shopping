/**
 * Open Food Facts Open Prices — crowd-sourced shelf prices by barcode.
 * https://prices.openfoodfacts.org/api
 */

const OPEN_PRICES = "https://prices.openfoodfacts.org/api/v1";

/** 1×1 PNG — SHOP_IMPORT proof placeholder for third-party app contributions. */
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * @param {string} barcode
 * @param {{ nearLat?: number, nearLng?: number, radiusKm?: number, size?: number }} [opts]
 */
export async function fetchOpenPricesByUpc(barcode, opts = {}) {
  const code = String(barcode ?? "").replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(code)) {
    throw new Error("upc must be 8–14 digits.");
  }
  return fetchOpenPricesByUpcs([code], opts).then((map) => map.get(code) ?? []);
}

/**
 * Batch lookup. Returns Map<upc, OpenPriceRow[]> (cheapest-first within each UPC).
 * Prefers nearby USD rows; falls back to USD anywhere, then any currency.
 *
 * @param {string[]} barcodes
 * @param {{ nearLat?: number, nearLng?: number, radiusKm?: number, size?: number }} [opts]
 * @returns {Promise<Map<string, object[]>>}
 */
export async function fetchOpenPricesByUpcs(barcodes, opts = {}) {
  const codes = [
    ...new Set(
      barcodes
        .map((b) => String(b ?? "").replace(/\D/g, ""))
        .filter((c) => /^\d{8,14}$/.test(c)),
    ),
  ];
  const out = new Map(codes.map((c) => [c, []]));
  if (codes.length === 0) return out;

  const lat = Number.isFinite(opts.nearLat) ? opts.nearLat : null;
  const lng = Number.isFinite(opts.nearLng) ? opts.nearLng : null;
  const radiusKm =
    lat != null && lng != null
      ? Math.min(Math.max(opts.radiusKm ?? 80, 1), 200)
      : null;

  /** @type {{ currency?: string, near?: boolean }[]} */
  const attempts = [];
  if (lat != null && lng != null && radiusKm != null) {
    attempts.push({ currency: "USD", near: true });
  }
  attempts.push({ currency: "USD", near: false });
  attempts.push({ near: false });

  for (const attempt of attempts) {
    const remaining = codes.filter((c) => (out.get(c) ?? []).length === 0);
    if (remaining.length === 0) break;

    const params = new URLSearchParams({
      product_code__in: remaining.join(","),
      order_by: "-date",
      size: String(Math.min(Math.max(remaining.length * 5, 1), 50)),
    });
    if (attempt.currency) params.set("currency", attempt.currency);
    if (attempt.near && lat != null && lng != null && radiusKm != null) {
      params.set("lat", String(lat));
      params.set("lon", String(lng));
      params.set("radius_km", String(radiusKm));
    }

    const res = await fetch(`${OPEN_PRICES}/prices?${params}`);
    if (!res.ok) {
      throw new Error(`Open Prices request failed (${res.status})`);
    }
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    const mapped = mapPriceItems(items);

    for (const code of remaining) {
      const rows = mapped.filter((row) => row.productCode === code);
      if (rows.length > 0) out.set(code, rows);
    }
  }

  return out;
}

/**
 * @param {object[]} items
 */
function mapPriceItems(items) {
  return items
    .map((row) => {
      const price = Number(row.price);
      const priceCents = Number.isFinite(price) ? Math.round(price * 100) : null;
      const productCode = String(row.product_code ?? "").replace(/\D/g, "");
      return {
        productCode,
        priceCents,
        currency: row.currency ?? null,
        date: row.date ?? null,
        storeName: row.location?.osm_name ?? row.location?.name ?? "Community store",
        city: row.location?.osm_address_city ?? null,
        country: row.location?.osm_address_country ?? row.location?.osm_address_country_code ?? null,
        lat: row.location?.osm_lat ?? null,
        lng: row.location?.osm_lon ?? null,
        source: "open_prices",
      };
    })
    .filter((row) => row.productCode && row.priceCents != null && row.priceCents > 0)
    .sort((a, b) => a.priceCents - b.priceCents);
}

async function getOpenPricesToken() {
  const existing = process.env.OPEN_PRICES_TOKEN?.trim();
  if (existing) return existing;

  const username = process.env.OPEN_PRICES_USERNAME?.trim();
  const password = process.env.OPEN_PRICES_PASSWORD?.trim();
  if (!username || !password) return null;

  const res = await fetch(`${OPEN_PRICES}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return typeof json?.access_token === "string" ? json.access_token : null;
}

/**
 * Best-effort contribute of a user-reported shelf price (SHOP_IMPORT proof).
 * No-ops when credentials are missing. Never throws to callers.
 *
 * @param {{
 *   upc: string,
 *   priceCents: number,
 *   date?: string,
 *   nearLat?: number,
 *   nearLng?: number,
 *   storeName?: string,
 * }} input
 */
export async function contributeOpenPrice(input) {
  try {
    const code = String(input.upc ?? "").replace(/\D/g, "");
    if (!/^\d{8,14}$/.test(code)) return { ok: false, reason: "bad_upc" };
    if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
      return { ok: false, reason: "bad_price" };
    }

    const token = await getOpenPricesToken();
    if (!token) return { ok: false, reason: "no_credentials" };

    const auth = { Authorization: `Bearer ${token}` };
    const date =
      input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
        ? input.date
        : new Date().toISOString().slice(0, 10);

    let locationOsmId = null;
    let locationOsmType = null;
    if (Number.isFinite(input.nearLat) && Number.isFinite(input.nearLng)) {
      const locParams = new URLSearchParams({
        lat: String(input.nearLat),
        lon: String(input.nearLng),
        radius_km: "5",
        size: "1",
      });
      const locRes = await fetch(`${OPEN_PRICES}/locations/nearby?${locParams}`);
      if (locRes.ok) {
        const locJson = await locRes.json().catch(() => null);
        const loc = Array.isArray(locJson?.items) ? locJson.items[0] : null;
        if (loc?.osm_id != null && loc?.osm_type) {
          locationOsmId = loc.osm_id;
          locationOsmType = loc.osm_type;
        }
      }
    }

    const form = new FormData();
    form.append("file", new Blob([MINIMAL_PNG], { type: "image/png" }), "butter-shop-import.png");
    form.append("type", "SHOP_IMPORT");
    form.append("currency", "USD");
    form.append("date", date);
    if (locationOsmId != null) form.append("location_osm_id", String(locationOsmId));
    if (locationOsmType) form.append("location_osm_type", String(locationOsmType));

    const proofRes = await fetch(`${OPEN_PRICES}/proofs/upload`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    if (!proofRes.ok) {
      return { ok: false, reason: `proof_upload_${proofRes.status}` };
    }
    const proof = await proofRes.json().catch(() => null);
    const proofId = proof?.id;
    if (proofId == null) return { ok: false, reason: "no_proof_id" };

    const priceBody = {
      product_code: code,
      price: input.priceCents / 100,
      currency: "USD",
      date,
      type: "PRODUCT",
      proof_id: proofId,
      owner_comment: input.storeName
        ? `Butter shopping report @ ${input.storeName}`
        : "Butter shopping user report",
    };
    if (locationOsmId != null) {
      priceBody.location_osm_id = locationOsmId;
      priceBody.location_osm_type = locationOsmType;
    }

    const priceRes = await fetch(`${OPEN_PRICES}/prices`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(priceBody),
    });
    if (!priceRes.ok) {
      return { ok: false, reason: `price_create_${priceRes.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "exception" };
  }
}
