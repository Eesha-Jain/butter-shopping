/**
 * One-shot: re-run keyword category assignment so fruit-flavored chips → Snacks
 * and sunscreen (e.g. Banana Boat) → Other. Skips category_source=manual.
 *
 * Usage: node backend/reclassify-produce-mistakes.js
 * Requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { assignProductCategories, canPersist } from "./persist.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

if (!canPersist()) {
  console.error("Persist is not configured (need Supabase URL + service role key).");
  process.exit(1);
}

const result = await assignProductCategories();
console.log(JSON.stringify(result, null, 2));
