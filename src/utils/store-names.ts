export type StoreLike = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  address_line1?: string | null;
  accepts_snap?: boolean;
  distance_km?: number | null;
};

export type StoreGroup<T extends StoreLike = StoreLike> = {
  key: string;
  name: string;
  stores: T[];
  ids: string[];
  acceptsSnap: boolean;
  nearestKm: number | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Fred Meyer - Ballard", "SAFEWAY #1234", "QFC (Capitol Hill)" → the bare chain name. */
export function cleanStoreName(name: string, city?: string | null): string {
  let s = name.replace(/\([^)]*\)/g, ' ');
  s = s.split(/\s+[-–—|:@]\s+/)[0] ?? s;
  s = s.replace(/\s*#\s*\d+.*$/, '');
  s = s.replace(/\s*[-–]\s*\d+\s*$/, '');
  s = s.replace(/\s+\d+\s*$/, '');
  const trimmedCity = city?.trim();
  if (trimmedCity) {
    const withoutCity = s.replace(new RegExp(`\\s+${escapeRegExp(trimmedCity)}\\s*$`, 'i'), '');
    if (withoutCity.trim()) s = withoutCity;
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s || name.trim();
}

/** Case, punctuation, and spacing-insensitive identity for a chain name. */
export function storeKey(name: string, city?: string | null): string {
  return cleanStoreName(name, city)
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isAllCaps(value: string): boolean {
  return /[A-Z]/.test(value) && value === value.toUpperCase();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function prettify(variants: string[]): string {
  const mixed = variants.find((variant) => !isAllCaps(variant));
  if (mixed) return mixed;
  const first = variants[0] ?? '';
  // A lone short all-caps word is an acronym (QFC, IGA), not shouting.
  if (/^[A-Z]{2,4}$/.test(first)) return first;
  return titleCase(first);
}

/** Display name for one store row, e.g. "FRED MEYER - Ballard" → "Fred Meyer". */
export function storeDisplayName(name: string, city?: string | null): string {
  return prettify([cleanStoreName(name, city)]);
}

/** One entry per chain. Input order is kept, so nearest-first input stays nearest-first. */
export function groupStores<T extends StoreLike>(stores: T[]): StoreGroup<T>[] {
  const byKey = new Map<string, { group: StoreGroup<T>; variants: string[] }>();
  for (const store of stores) {
    const key = storeKey(store.name, store.city);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        group: {
          key,
          name: '',
          stores: [],
          ids: [],
          acceptsSnap: false,
          nearestKm: null,
        },
        variants: [],
      };
      byKey.set(key, entry);
    }
    entry.group.stores.push(store);
    entry.group.ids.push(store.id);
    if (store.accepts_snap) entry.group.acceptsSnap = true;
    if (store.distance_km != null) {
      entry.group.nearestKm =
        entry.group.nearestKm == null
          ? store.distance_km
          : Math.min(entry.group.nearestKm, store.distance_km);
    }
    entry.variants.push(cleanStoreName(store.name, store.city));
  }
  return [...byKey.values()].map(({ group, variants }) => ({
    ...group,
    name: prettify(variants),
  }));
}

/** Add the group's stores to the selection, or remove them if all are already selected. */
export function toggleGroupIds(group: StoreGroup, selectedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  const allIn = group.ids.every((id) => selected.has(id));
  if (allIn) return selectedIds.filter((id) => !group.ids.includes(id));
  return [...new Set([...selectedIds, ...group.ids])];
}

/** Readable labels for the current selection: whole chains by name, partial picks with city. */
export function describeSelection<T extends StoreLike>(
  groups: StoreGroup<T>[],
  selectedIds: string[],
): string[] {
  const selected = new Set(selectedIds);
  const labels: string[] = [];
  for (const group of groups) {
    const picked = group.stores.filter((store) => selected.has(store.id));
    if (picked.length === 0) continue;
    if (picked.length === group.stores.length) {
      labels.push(group.name);
      continue;
    }
    for (const store of picked) {
      labels.push(store.city ? `${group.name} · ${store.city}` : group.name);
    }
  }
  return labels;
}

function words(value: string | null | undefined): string[] {
  return (value ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Stores whose name or location (city, state, zip, street) matches every word of the query.
 * Words must start a word in the store text; very short words are ignored.
 */
export function matchStoresForQuery<T extends StoreLike>(query: string, stores: T[]): T[] {
  const tokens = words(query).filter((token) => token.length >= 3);
  if (tokens.length === 0) return [];
  return stores.filter((store) => {
    const haystack = [
      ...words(cleanStoreName(store.name, store.city)),
      ...words(store.city),
      ...words(store.region),
      ...words(store.postal_code),
      ...words(store.address_line1),
    ];
    return tokens.every((token) => haystack.some((word) => word.startsWith(token)));
  });
}
