/**
 * Open Food Facts Open Prices — crowd-sourced shelf prices by barcode.
 * https://prices.openfoodfacts.org/api
 */

const OPEN_PRICES = "https://prices.openfoodfacts.org/api/v1";

/**
 * @param {string} barcode
 * @param {{ nearLat?: number, nearLng?: number, size?: number }} [opts]
 */
export async function fetchOpenPricesByUpc(barcode, opts = {}) {
  const code = String(barcode ?? "").replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(code)) {
    throw new Error("upc must be 8–14 digits.");
  }
  const size = Math.min(Math.max(opts.size ?? 15, 1), 50);
  const params = new URLSearchParams({
    product_code: code,
    order_by: "-date",
    size: String(size),
  });
  const res = await fetch(`${OPEN_PRICES}/prices?${params}`);
  if (!res.ok) {
    throw new Error(`Open Prices request failed (${res.status})`);
  }
  const json = await res.json();
  const items = Array.isArray(json?.items) ? json.items : [];

  const mapped = items.map((row) => {
    const price = Number(row.price);
    const priceCents = Number.isFinite(price) ? Math.round(price * 100) : null;
    return {
      priceCents,
      currency: row.currency ?? null,
      date: row.date ?? null,
      storeName: row.location?.osm_name ?? row.location?.name ?? "Community store",
      city: row.location?.osm_address_city ?? null,
      country: row.location?.osm_address_country ?? row.location?.country_code ?? null,
      source: "open_prices",
    };
  });

  // Prefer USD for US shoppers; fall back to any priced row when none.
  const usd = mapped.filter((row) => row.currency === "USD" && row.priceCents != null);
  return usd.length > 0 ? usd : mapped.filter((row) => row.priceCents != null);
}
