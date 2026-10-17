// src/api/kroger.js
import { BACKEND_URL } from "./config";

export async function findStores(zip) {
  const res = await fetch(`${BACKEND_URL}/api/kroger/locations?zip=${zip}`);
  if (!res.ok) throw new Error("Could not load stores");
  const json = await res.json();
  return json.data; // Kroger wraps results in a "data" array
}

export async function searchProducts(term, locationId) {
  const url =
    `${BACKEND_URL}/api/kroger/products` +
    `?term=${encodeURIComponent(term)}&locationId=${locationId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load products");
  const json = await res.json();

  // Flatten Kroger's nested response into a simple shape your UI can use
  return json.data.map((p) => {
    const item = p.items?.[0]; // price info lives inside the first "item"
    return {
      id: p.productId,
      upc: p.upc,
      name: p.description,
      brand: p.brand,
      regularPrice: item?.price?.regular ?? null,
      promoPrice: item?.price?.promo ?? null, // 0 or null if no sale
      size: item?.size,
      store: "Kroger",
    };
  });
}