import { BACKEND_URL } from "./config";

/**
 * Live shelf prices. QFC comes from the Kroger API. Safeway is attempted only
 * when that search returns nothing.
 */
export async function searchShelfPrices({ term, zip, locationId }) {
  const params = new URLSearchParams({ term });
  if (zip) params.set("zip", zip);
  if (locationId) params.set("locationId", locationId);
  const res = await fetch(`${BACKEND_URL}/api/prices?${params}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !json.qfc && !json.safeway) {
    throw new Error(json.error ?? "Could not load prices");
  }
  return {
    qfc: json.qfc ?? [],
    safeway: json.safeway ?? [],
    store: json.store ?? null,
    qfcError: json.qfcError ?? null,
    safewayError: json.safewayError ?? null,
  };
}
