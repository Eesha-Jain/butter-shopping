import type { FoodTrait, Product, ProductTrait, UserFoodRule } from '../types';

export type ShopSort = 'default' | 'cheapest' | 'name';

export type SessionFoodRule = {
  trait_id: string;
  mode: UserFoodRule['mode'];
};

/**
 * Applies avoid/require hard filters and prefer soft ranking, then sort.
 * Prefer does not hide products with unknown traits.
 */
export function applyFoodFilters(
  products: Product[],
  rules: SessionFoodRule[],
  traitsByProduct: Map<string, ProductTrait[]>,
  options?: {
    sort?: ShopSort;
    stapleIds?: Set<string>;
    onSaleOnly?: boolean;
    promotionProductIds?: Set<string>;
    priceCentsByProduct?: Map<string, number>;
  },
): Product[] {
  const avoid = rules.filter((rule) => rule.mode === 'avoid').map((rule) => rule.trait_id);
  const require = rules.filter((rule) => rule.mode === 'require').map((rule) => rule.trait_id);
  const prefer = rules.filter((rule) => rule.mode === 'prefer').map((rule) => rule.trait_id);
  const onSaleOnly = options?.onSaleOnly ?? false;
  const promoIds = options?.promotionProductIds ?? new Set<string>();
  const stapleIds = options?.stapleIds ?? new Set<string>();
  const prices = options?.priceCentsByProduct ?? new Map<string, number>();
  const sort = options?.sort ?? 'default';

  let filtered = products.filter((product) => {
    if (onSaleOnly && !promoIds.has(product.id)) {
      // promoIds may also include products with a shelf regular>sale delta.
      return false;
    }
    const traits = traitsByProduct.get(product.id) ?? [];
    for (const traitId of avoid) {
      const hit = traits.some(
        (trait) =>
          trait.trait_id === traitId &&
          (trait.relation === 'contains' || trait.relation === 'may_contain'),
      );
      if (hit) return false;
    }
    for (const traitId of require) {
      const ok = traits.some(
        (trait) =>
          trait.trait_id === traitId &&
          (trait.relation === 'suitable' || trait.relation === 'certified'),
      );
      if (!ok) return false;
    }
    return true;
  });

  const preferScore = (productId: string) => {
    const traits = traitsByProduct.get(productId) ?? [];
    return prefer.reduce((score, traitId) => {
      const hit = traits.some(
        (trait) =>
          trait.trait_id === traitId &&
          (trait.relation === 'suitable' || trait.relation === 'certified'),
      );
      return score + (hit ? 1 : 0);
    }, 0);
  };

  filtered = [...filtered].sort((a, b) => {
    if (sort === 'name') {
      return a.name.localeCompare(b.name);
    }
    if (sort === 'cheapest') {
      const pa = prices.get(a.id);
      const pb = prices.get(b.id);
      if (pa != null && pb != null && pa !== pb) return pa - pb;
      if (pa != null && pb == null) return -1;
      if (pa == null && pb != null) return 1;
      const aSale = promoIds.has(a.id) ? 0 : 1;
      const bSale = promoIds.has(b.id) ? 0 : 1;
      if (aSale !== bSale) return aSale - bSale;
      return a.name.localeCompare(b.name);
    }
    const aStaple = stapleIds.has(a.id) ? 0 : 1;
    const bStaple = stapleIds.has(b.id) ? 0 : 1;
    if (aStaple !== bStaple) return aStaple - bStaple;
    const pref = preferScore(b.id) - preferScore(a.id);
    if (pref !== 0) return pref;
    return a.name.localeCompare(b.name);
  });

  return filtered;
}

/** Groups food traits for the filter drawer UI. */
export function groupTraitsForFilterUi(traits: FoodTrait[]): {
  avoid: FoodTrait[];
  requirePrefer: FoodTrait[];
} {
  return {
    avoid: traits.filter((trait) =>
      trait.kind === 'allergen' || trait.kind === 'ingredient' || trait.kind === 'chemical',
    ),
    requirePrefer: traits.filter(
      (trait) => trait.kind === 'dietary' || trait.kind === 'certification',
    ),
  };
}

export type AvoidTraitGroupId = 'seafood' | 'nuts' | 'dairy-eggs' | 'grains' | 'other';

export type AvoidTraitGroup = {
  id: AvoidTraitGroupId;
  label: string;
  /** When set, show a parent chip that toggles every trait in the group. */
  groupChipLabel?: string;
  traits: FoodTrait[];
};

const AVOID_GROUP_DEFS: {
  id: AvoidTraitGroupId;
  label: string;
  groupChipLabel?: string;
  codes: string[];
}[] = [
  { id: 'seafood', label: 'Seafood', groupChipLabel: 'Seafood', codes: ['fish', 'shellfish'] },
  { id: 'nuts', label: 'Nuts', groupChipLabel: 'Nuts', codes: ['peanuts', 'tree-nuts'] },
  { id: 'dairy-eggs', label: 'Dairy & eggs', codes: ['milk', 'eggs'] },
  { id: 'grains', label: 'Grains', codes: ['wheat', 'gluten'] },
  { id: 'other', label: 'Other', codes: ['soy', 'sesame', 'red-dye-40'] },
];

/** Buckets avoid traits into labeled subsections for the shop filter UI. */
export function groupAvoidTraitsForFilterUi(avoidTraits: FoodTrait[]): AvoidTraitGroup[] {
  const byCode = new Map(avoidTraits.map((trait) => [trait.code, trait]));
  const usedIds = new Set<string>();
  const groups: AvoidTraitGroup[] = [];

  for (const def of AVOID_GROUP_DEFS) {
    const traits = def.codes
      .map((code) => byCode.get(code))
      .filter((trait): trait is FoodTrait => trait != null);
    for (const trait of traits) usedIds.add(trait.id);
    if (traits.length > 0) {
      groups.push({
        id: def.id,
        label: def.label,
        groupChipLabel: def.groupChipLabel,
        traits,
      });
    }
  }

  const leftovers = avoidTraits.filter((trait) => !usedIds.has(trait.id));
  if (leftovers.length > 0) {
    const other = groups.find((group) => group.id === 'other');
    if (other) {
      other.traits.push(...leftovers);
    } else {
      groups.push({ id: 'other', label: 'Other', traits: leftovers });
    }
  }

  return groups;
}

export function areAllTraitsAvoided(traitIds: string[], rules: SessionFoodRule[]): boolean {
  if (traitIds.length === 0) return false;
  const avoided = new Set(
    rules.filter((rule) => rule.mode === 'avoid').map((rule) => rule.trait_id),
  );
  return traitIds.every((id) => avoided.has(id));
}

/** Toggle avoid for every trait in a group (all on → all off, otherwise all on). */
export function toggleAvoidGroup(traitIds: string[], rules: SessionFoodRule[]): SessionFoodRule[] {
  const idSet = new Set(traitIds);
  const without = rules.filter((rule) => !idSet.has(rule.trait_id));
  if (areAllTraitsAvoided(traitIds, rules)) return without;
  return [...without, ...traitIds.map((trait_id) => ({ trait_id, mode: 'avoid' as const }))];
}

export function rulesFromUserFoodRules(rules: UserFoodRule[]): SessionFoodRule[] {
  return rules.map((rule) => ({ trait_id: rule.trait_id, mode: rule.mode }));
}

export function indexTraitsByProduct(traits: ProductTrait[]): Map<string, ProductTrait[]> {
  const map = new Map<string, ProductTrait[]>();
  for (const trait of traits) {
    const list = map.get(trait.product_id) ?? [];
    list.push(trait);
    map.set(trait.product_id, list);
  }
  return map;
}
