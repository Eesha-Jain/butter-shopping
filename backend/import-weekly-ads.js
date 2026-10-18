/**
 * Import product-scoped weekly-ad deals into promotions via the offer pipeline.
 *
 * Usage:
 *   node import-weekly-ads.js path/to/ads.json
 *   node import-weekly-ads.js weekly-ads.sample.json
 *
 * JSON shape: { chainName, startsAt, endsAt, deals: [{ productUpc, productName,
 *   discountType, discountValue, buyQuantity?, getQuantity?, label?, externalRef? }] }
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

import { promotionOffer } from "./pipeline/envelope.js";
import { canIngest, ingestPromotion } from "./pipeline/ingest.js";

loadEnv({ path: resolve(process.cwd(), "../.env.local") });
loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv();

function usage() {
  console.error("Usage: node import-weekly-ads.js <ads.json>");
  process.exit(1);
}

async function main() {
  const file = process.argv[2];
  if (!file) usage();
  if (!canIngest()) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to import ads.");
  }

  const payload = JSON.parse(readFileSync(resolve(file), "utf8"));
  const chainName = String(payload.chainName ?? "").trim();
  const startsAt = payload.startsAt;
  const endsAt = payload.endsAt;
  const deals = Array.isArray(payload.deals) ? payload.deals : [];
  if (!chainName || !startsAt || !endsAt) {
    throw new Error("ads.json requires chainName, startsAt, endsAt.");
  }
  if (deals.length === 0) {
    console.log("No deals in file.");
    return;
  }

  let saved = 0;
  let skipped = 0;
  for (const deal of deals) {
    const upc = deal.productUpc ?? deal.upc ?? null;
    const name = deal.productName ?? deal.name ?? null;
    if (!upc && !name) {
      skipped += 1;
      continue;
    }
    const discountType = deal.discountType ?? "amount_off";
    const envelope = promotionOffer({
      chainName,
      discountType,
      discountValue: deal.discountValue ?? (discountType === "bogo" ? 0 : 0),
      buyQuantity: deal.buyQuantity ?? null,
      getQuantity: deal.getQuantity ?? null,
      label: deal.label ?? null,
      startsAt: deal.startsAt ?? startsAt,
      endsAt: deal.endsAt ?? endsAt,
      productUpc: upc,
      productName: name,
      productBrand: deal.productBrand ?? deal.brand ?? null,
      externalRef:
        deal.externalRef ??
        `weekly-ad:${chainName.toLowerCase().replace(/\s+/g, "-")}:${String(startsAt).slice(0, 10)}:${upc ?? name}`,
    });
    await ingestPromotion(envelope);
    saved += 1;
  }

  console.log(`Imported ${saved} weekly-ad promotion(s); skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
