import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, "src/backend/.env") });
dotenv.config({ path: path.join(root, ".env.local") });

const QUERY =
  "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0/query";

const CHAIN_NAMES = [
  ["qfc", "QFC"],
  ["safeway", "Safeway"],
  ["trader joe", "Trader Joe's"],
  ["fred meyer", "Fred Meyer"],
  ["whole foods", "Whole Foods Market"],
];

function config() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY before importing SNAP stores.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(pathAndQuery, options = {}) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} for ${pathAndQuery.split("?")[0]}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function field(attributes, names) {
  for (const name of names) {
    if (attributes[name] != null && attributes[name] !== "") return attributes[name];
  }
  return null;
}

const GROCERY_TYPES = new Set(["grocery store", "super store", "supermarket"]);

function keepGrocery(type) {
  return GROCERY_TYPES.has(String(type ?? "").trim().toLowerCase());
}

function zip5(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(0, 5);
}

function chainNameFor(storeName) {
  const value = storeName.toLowerCase();
  return CHAIN_NAMES.find(([needle]) => value.includes(needle))?.[1] ?? null;
}

async function chainId(name) {
  const existing = await rest(`chains?name=eq.${encodeURIComponent(name)}&select=id&limit=1`);
  if (existing?.[0]?.id) return existing[0].id;
  const created = await rest("chains", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name }),
  });
  return created?.[0]?.id ?? null;
}

async function fetchWashington() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const url = new URL(QUERY);
    url.searchParams.set("where", "State='WA'");
    url.searchParams.set("outFields", "*");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "json");
    url.searchParams.set("resultRecordCount", "1000");
    url.searchParams.set("resultOffset", String(offset));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`USDA SNAP query failed: ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message ?? "USDA SNAP query failed");
    const features = json.features ?? [];
    rows.push(...features);
    if (features.length < 1000) break;
    offset += features.length;
  }
  return rows;
}

async function importStores(features) {
  let updated = 0;
  let inserted = 0;
  for (const feature of features) {
    const attributes = feature.attributes ?? {};
    const type = field(attributes, ["Store_Type", "STORE_TYPE", "StoreType"]);
    if (!keepGrocery(type)) continue;
    const name = String(field(attributes, ["Store_Name", "STORE_NAME", "StoreName"]) ?? "").trim();
    const postal = zip5(field(attributes, ["Zip_Code", "ZIP_CODE", "Zip", "Zip5"]));
    if (!name || postal.length !== 5) continue;
    const objectId = field(attributes, ["ObjectId", "OBJECTID", "objectid"]) ?? `${name}|${postal}`;
    const existing = await rest(
      `stores?postal_code=eq.${postal}&select=id,name&limit=50`,
    );
    const match = (existing ?? []).find((store) => store.name.trim().toLowerCase() === name.toLowerCase());
    if (match) {
      await rest(`stores?id=eq.${match.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ accepts_snap: true, region: "WA" }),
      });
      updated += 1;
      continue;
    }
    const chain = chainNameFor(name);
    const geometry = feature.geometry ?? {};
    await rest("stores?on_conflict=source,source_ref", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        name,
        chain_id: chain ? await chainId(chain) : null,
        address_line1: field(attributes, ["Store_Street_Address", "Address", "Street"]) ?? null,
        city: field(attributes, ["City", "CITY"]) ?? null,
        region: "WA",
        postal_code: postal,
        country: "US",
        latitude: geometry.y ?? field(attributes, ["Latitude", "LATITUDE"]) ?? null,
        longitude: geometry.x ?? field(attributes, ["Longitude", "LONGITUDE"]) ?? null,
        accepts_snap: true,
        source: "usda_snap",
        source_ref: String(objectId),
      }),
    });
    inserted += 1;
  }
  return { updated, inserted };
}

async function importDiscounts() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "wa-discounts.json");
  const policies = JSON.parse(fs.readFileSync(file, "utf8"));
  let saved = 0;
  for (const policy of policies) {
    const chain = await chainId(policy.chain);
    const existing = await rest(
      `promotions?chain_id=eq.${chain}&requires_group=eq.${encodeURIComponent(policy.requiresGroup)}&select=id&limit=1`,
    );
    const row = {
      chain_id: chain,
      discount_type: "percent_off",
      discount_value: policy.percent,
      requires_group: policy.requiresGroup,
      weekdays: policy.weekdays ?? null,
      month_days: policy.monthDays ?? null,
      month_ordinals: policy.monthOrdinals ?? null,
      starts_at: policy.startsAt,
      ends_at: policy.endsAt,
    };
    if (existing?.[0]?.id) {
      await rest(`promotions?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
    } else {
      await rest("promotions", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
    }
    saved += 1;
  }
  return saved;
}

function sqlText(value) {
  if (value == null || String(value).trim() === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNum(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "null";
}

function groceryRows(features) {
  const rows = [];
  const seen = new Set();
  for (const feature of features) {
    const attributes = feature.attributes ?? {};
    if (!keepGrocery(field(attributes, ["Store_Type", "STORE_TYPE", "StoreType"]))) continue;
    const name = String(field(attributes, ["Store_Name", "STORE_NAME", "StoreName"]) ?? "").trim();
    const postal = zip5(field(attributes, ["Zip_Code", "ZIP_CODE", "Zip", "Zip5"]));
    if (!name || postal.length !== 5) continue;
    const objectId = field(attributes, ["ObjectId", "OBJECTID", "objectid"]) ?? `${name}|${postal}`;
    const sourceRef = String(objectId);
    if (seen.has(sourceRef)) continue;
    seen.add(sourceRef);
    const geometry = feature.geometry ?? {};
    rows.push({
      name,
      address: field(attributes, ["Store_Street_Address", "Address", "Street"]),
      city: field(attributes, ["City", "CITY"]),
      postal,
      latitude: geometry.y ?? field(attributes, ["Latitude", "LATITUDE"]),
      longitude: geometry.x ?? field(attributes, ["Longitude", "LONGITUDE"]),
      sourceRef,
      chain: chainNameFor(name),
    });
  }
  return rows;
}

function writeSqlFiles(rows, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const setup = `create table if not exists public.wa_snap_stage (
  name text not null,
  address text,
  city text,
  postal_code text not null,
  latitude double precision,
  longitude double precision,
  source_ref text not null,
  chain_name text
);
truncate public.wa_snap_stage;
`;
  fs.writeFileSync(path.join(directory, "00-setup.sql"), setup);
  const size = 200;
  for (let index = 0; index < rows.length; index += size) {
    const values = rows.slice(index, index + size).map(
      (row) =>
        `(${sqlText(row.name)}, ${sqlText(row.address)}, ${sqlText(row.city)}, ${sqlText(row.postal)}, ${sqlNum(row.latitude)}, ${sqlNum(row.longitude)}, ${sqlText(row.sourceRef)}, ${sqlText(row.chain)})`,
    );
    const file = `${String(index / size + 1).padStart(3, "0")}-rows.sql`;
    fs.writeFileSync(
      path.join(directory, file),
      `insert into public.wa_snap_stage (name, address, city, postal_code, latitude, longitude, source_ref, chain_name) values\n${values.join(",\n")};\n`,
    );
  }
  fs.writeFileSync(
    path.join(directory, "99-merge.sql"),
    `insert into public.chains (name)
select distinct chain_name
from public.wa_snap_stage
where chain_name is not null
on conflict do nothing;

update public.stores as store
set accepts_snap = true,
    region = 'WA'
from public.wa_snap_stage as incoming
where store.postal_code = incoming.postal_code
  and lower(btrim(store.name)) = lower(btrim(incoming.name));

insert into public.stores (
  name, chain_id, address_line1, city, region, postal_code, country,
  latitude, longitude, accepts_snap, source, source_ref
)
select
  incoming.name,
  chain.id,
  incoming.address,
  incoming.city,
  'WA',
  incoming.postal_code,
  'US',
  incoming.latitude,
  incoming.longitude,
  true,
  'usda_snap',
  incoming.source_ref
from public.wa_snap_stage as incoming
left join public.chains as chain on chain.name = incoming.chain_name
where not exists (
  select 1
  from public.stores as store
  where store.postal_code = incoming.postal_code
    and lower(btrim(store.name)) = lower(btrim(incoming.name))
)
on conflict (source, source_ref) do update
set accepts_snap = true,
    region = 'WA';

drop table public.wa_snap_stage;
`,
  );
}

const sqlDir = process.argv.indexOf("--sql-dir");
const features = await fetchWashington();
if (sqlDir !== -1) {
  const rows = groceryRows(features);
  writeSqlFiles(rows, process.argv[sqlDir + 1]);
  console.log(`Wrote SQL for ${rows.length} Washington grocery SNAP stores.`);
} else {
  const stores = await importStores(features);
  const discounts = await importDiscounts();
  console.log(
    `Washington SNAP groceries: ${stores.inserted} added, ${stores.updated} marked. Discount rows saved: ${discounts}.`,
  );
}
