// src/api/openPrices.js
const OPEN_PRICES = "https://prices.openfoodfacts.org/api/v1";

// Open Prices looks up by barcode (UPC/EAN), not by name
export async function getCrowdsourcedPrices(barcode) {
  const url =
    `${OPEN_PRICES}/prices?product_code=${barcode}` +
    `&order_by=-date&size=10`; // newest first, 10 results
  const res = await fetch(url);
  if (!res.ok) throw new Error("Open Prices request failed");
  const json = await res.json();

  return json.items.map((p) => ({
    price: p.price,
    currency: p.currency,
    date: p.date,
    store: p.location?.osm_name ?? "Unknown store",
    city: p.location?.osm_address_city,
    source: "Open Prices",
  }));
}