/**
 * One-shot / weekly staple ingest for a campus ZIP.
 * Requires the price proxy running with persist enabled.
 *
 * Usage:
 *   node bootstrap-staples.js
 *   node bootstrap-staples.js --zip=98195 --concurrency=2
 *   node bootstrap-staples.js --base=http://127.0.0.1:3000 --terms=./staple-terms.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { canPersist } from './persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const zip = arg('zip', '98195');
const base = arg('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const concurrency = Math.max(1, Number(arg('concurrency', '2')) || 2);
const delayMs = Math.max(0, Number(arg('delay', '300')) || 300);
const termsPath = path.resolve(__dirname, arg('terms', './staple-terms.json'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assignCategories(baseUrl) {
  // Category assignment runs through the proxy so service-role stays server-side.
  const res = await fetch(`${baseUrl}/api/admin/assign-categories`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Category assign failed (${res.status})`);
  }
  return res.json();
}

async function main() {
  if (!/^\d{5}$/.test(zip)) {
    console.error('ZIP must be 5 digits.');
    process.exit(1);
  }

  const healthRes = await fetch(`${base}/api/health`);
  const health = await healthRes.json().catch(() => ({}));
  if (!health.persist) {
    console.error(
      'Persist is off. Set SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY, then restart the backend.',
    );
    console.error('Health:', health);
    process.exit(1);
  }
  if (!canPersist()) {
    console.warn(
      'Local canPersist() is false (env not loaded in this process). Continuing via proxy health check.',
    );
  }

  const terms = JSON.parse(fs.readFileSync(termsPath, 'utf8'));
  if (!Array.isArray(terms) || terms.length === 0) {
    console.error('No staple terms found at', termsPath);
    process.exit(1);
  }

  console.log(`Bootstrapping ${terms.length} terms for ZIP ${zip} via ${base}`);
  console.log(`Concurrency ${concurrency}, delay ${delayMs}ms`);

  let index = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (index < terms.length) {
      const term = terms[index++];
      const url = `${base}/api/prices?term=${encodeURIComponent(term)}&zip=${zip}`;
      try {
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));
        const offers = json.offers ?? [];
        const priced = offers.filter((offer) => Number.isInteger(offer.priceCents)).length;
        if (!res.ok && offers.length === 0) {
          failed += 1;
          console.warn(`  FAIL  ${term}: ${json.qfcError || json.safewayError || res.status}`);
        } else {
          ok += 1;
          console.log(`  OK    ${term}: ${offers.length} offers (${priced} priced)`);
        }
      } catch (error) {
        failed += 1;
        console.warn(`  FAIL  ${term}: ${error.message}`);
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  try {
    const assigned = await assignCategories(base);
    console.log(`Categories: updated ${assigned.updated ?? 0} products`);
    console.log('Category summary:', assigned.byCategory ?? assigned);
  } catch (error) {
    console.warn('Category assignment skipped:', error.message);
  }

  console.log(`Done. ok=${ok} failed=${failed}`);
  if (ok === 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
