/**
 * Compatibility wrapper around the unified offer pipeline.
 * Collectors should prefer pipeline/envelope.js + ingestShelf directly.
 */

import { shelfOffer } from "./pipeline/envelope.js";
import { canIngest, ingestShelf } from "./pipeline/ingest.js";

export function canPersist() {
  return canIngest();
}

/**
 * Appends an api or scrape price through Validate → Match → write.
 * Accepts the legacy observation shape or a shelf envelope.
 */
export async function saveObservedPrice(observation) {
  const envelope =
    observation.kind === "shelf"
      ? observation
      : shelfOffer({
          source: observation.priceSource ?? observation.source,
          chainName: observation.chainName,
          storeSource: observation.storeSource,
          storeRef: observation.storeRef,
          storeName: observation.storeName,
          address: observation.address,
          city: observation.city,
          region: observation.region,
          postalCode: observation.postalCode,
          latitude: observation.latitude,
          longitude: observation.longitude,
          productName: observation.productName,
          brand: observation.brand,
          upc: observation.upc,
          externalRef: observation.productRef ?? observation.externalRef,
          productUrl: observation.productUrl,
          priceCents: observation.priceCents,
          regularPriceCents: observation.regularPriceCents,
          promoPriceCents: observation.promoPriceCents,
          observedAt: observation.observedAt,
        });
  return ingestShelf(envelope);
}
