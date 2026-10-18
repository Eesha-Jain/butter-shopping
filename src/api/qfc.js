import { BACKEND_URL } from "./config";

async function read(res, fallback) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? fallback);
  return json;
}

export async function findQfcStores(zip) {
  const res = await fetch(`${BACKEND_URL}/api/qfc/locations?zip=${encodeURIComponent(zip)}`);
  const json = await read(res, "Could not load QFC stores");
  return json.data;
}

export async function searchQfcProducts(term, locationId) {
  const params = new URLSearchParams({ term });
  if (locationId) params.set("locationId", locationId);
  const res = await fetch(`${BACKEND_URL}/api/qfc/products?${params}`);
  const json = await read(res, "Could not load QFC products");
  return json.data;
}
