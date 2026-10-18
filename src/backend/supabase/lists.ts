import type { GroceryList, Group, ListItem, RecipeIngredient, ResolvedListItem } from '../types';
import { supabase } from './client';
import { AppError, fail } from '../errors';
import { unwrap, unwrapOne, unwrapVoid } from './query';
import { listMyGroups } from './groups';
import { addDueHabitItems, listActivePantryItems, listHabits } from './purchases';

export type RecipeListSkipReason = 'still_have' | 'already_on_list' | 'not_in_catalog';

export type RecipeListPreviewLine = {
  ingredientId: string;
  label: string;
  categoryId: string | null;
  productId: string | null;
  amountBase: number | null;
  reason?: RecipeListSkipReason;
  lastPurchasedAt?: string | null;
  expiresOn?: string | null;
};

export type RecipeListPreview = {
  recipeId: string;
  title: string;
  willAdd: RecipeListPreviewLine[];
  skipped: RecipeListPreviewLine[];
};

export type ActiveListTarget = {
  group: Group;
  list: GroceryList;
};

/**
 * Expected empty state (guest / signup race). Throws without toasting so callers
 * can fall back quietly; use fail() only for unexpected failures.
 */
function missingListError(message: string): never {
  throw new AppError(message);
}

/**
 * Lists in a group. Every group has one default list created with the group.
 */
export async function listGroupLists(groupId: string): Promise<GroceryList[]> {
  return unwrap(await supabase.from('lists').select('*').eq('group_id', groupId).order('created_at'));
}

/** Personal group default list (signup “My List”), or first available default list. */
export async function getMyDefaultList(): Promise<ActiveListTarget> {
  const targets = await listMyListTargets();
  const personal = targets.find((row) => row.group.kind === 'personal');
  if (personal) return personal;
  if (targets[0]) return targets[0];
  missingListError('No grocery list found. New accounts receive a personal list at signup.');
}

/** Default list for each group the caller belongs to (list switcher). */
export async function listMyListTargets(): Promise<ActiveListTarget[]> {
  const groups = await listMyGroups();
  const targets: ActiveListTarget[] = [];
  for (const group of groups) {
    const lists = await listGroupLists(group.id);
    const list = lists.find((row) => row.is_default) ?? lists[0];
    if (list) targets.push({ group, list });
  }
  return targets;
}

/**
 * Open list items keyed by product id for Shop cards (qty + list_item id).
 * Category/custom lines without a product_id are omitted from the map.
 */
export async function getActiveListProductQtyMap(
  listId: string,
): Promise<Map<string, { listItemId: string; quantity: number }>> {
  const items = await listResolvedItems(listId);
  const map = new Map<string, { listItemId: string; quantity: number }>();
  for (const item of items) {
    if (!item.product_id || item.done_at) continue;
    map.set(item.product_id, { listItemId: item.id, quantity: Number(item.quantity) });
  }
  return map;
}

/** Creates another named list in a group the caller belongs to. */
export async function createList(input: { groupId: string; name: string }): Promise<GroceryList> {
  return unwrapOne(
    await supabase
      .from('lists')
      .insert({ group_id: input.groupId, name: input.name, is_default: false })
      .select('*')
      .maybeSingle(),
    'List insert did not return a row.',
  );
}

/**
 * Adds one real catalog product to a list. Category-only and custom-name lines
 * are not written.
 */
export async function addListItem(input: {
  listId: string;
  productId?: string;
  categoryId?: string;
  customName?: string;
  quantity?: number;
  amountBase?: number;
  sizeFlexible?: boolean;
  sourceRecipeId?: string;
}): Promise<ListItem> {
  if (!input.productId || input.categoryId || input.customName) {
    fail('A list item has to be a real product.');
  }
  const productId = input.productId;
  const addQty = input.quantity ?? 1;

  const bumpExisting = async (): Promise<ListItem | null> => {
    const existing = await openProductOnList(input.listId, productId);
    if (!existing) return null;
    return unwrapOne(
      await supabase
        .from('list_items')
        .update({ quantity: existing.quantity + addQty })
        .eq('id', existing.id)
        .select('*')
        .maybeSingle(),
      'List item update did not return a row.',
    );
  };

  // Merge into an existing open row instead of creating a duplicate line.
  const merged = await bumpExisting();
  if (merged) return merged;

  const user = await supabase.auth.getUser();
  const inserted = await supabase
    .from('list_items')
    .insert({
      list_id: input.listId,
      added_by: user.data.user?.id ?? null,
      product_id: productId,
      category_id: input.categoryId ?? null,
      custom_name: input.customName ?? null,
      quantity: addQty,
      amount_base: input.amountBase ?? null,
      size_flexible: input.sizeFlexible ?? true,
      source_recipe_id: input.sourceRecipeId ?? null,
    })
    .select('*')
    .maybeSingle();

  // Lost a race with a concurrent add (unique index): fold into the winner's row.
  if (inserted.error?.code === '23505') {
    const retried = await bumpExisting();
    if (retried) return retried;
  }
  return unwrapOne(inserted, 'List item insert did not return a row.');
}

/** Changes quantity, amount, or the checked-off time of a list item. */
export async function updateListItem(
  itemId: string,
  patch: Partial<Pick<ListItem, 'quantity' | 'amount_base' | 'size_flexible' | 'done_at'>>,
): Promise<ListItem> {
  return unwrapOne(
    await supabase.from('list_items').update(patch).eq('id', itemId).select('*').maybeSingle(),
    'List item update did not return a row.',
  );
}

/** Checks an item off or returns it to the open list. */
export async function setListItemDone(itemId: string, done: boolean): Promise<ListItem> {
  return updateListItem(itemId, { done_at: done ? new Date().toISOString() : null });
}

/** Deletes one list item. */
export async function removeListItem(itemId: string): Promise<void> {
  unwrapVoid(await supabase.from('list_items').delete().eq('id', itemId));
}

/**
 * Open and completed items with display names and the cheapest current shelf
 * price. That price does not apply food rules or coupons. Use recommendShoppingPlan
 * before creating a trip.
 */
export async function listResolvedItems(listId: string): Promise<ResolvedListItem[]> {
  return unwrap(await supabase.from('v_list_items').select('*').eq('list_id', listId));
}

export type CatalogLine = {
  /** Brand, product name, and pack size from the products table. */
  title: string;
  /** Shelf price and store, when the list view found one. */
  offer: string | null;
};

/** Brand + name + size. Falls back to the name alone. */
export function formatCatalogTitle(product: {
  name: string;
  brand?: string | null;
  size_base_amount?: number | null;
  size_base_unit?: string | null;
}): string {
  const brand = product.brand?.trim();
  const name = product.name.trim();
  const titled = brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
  const amount = Number(product.size_base_amount);
  if (Number.isFinite(amount) && amount > 0 && product.size_base_unit) {
    return `${titled}, ${amount} ${product.size_base_unit}`;
  }
  return titled;
}

function formatOffer(cents: number | null, storeName: string | null): string | null {
  if (cents == null && !storeName) return null;
  const price = cents == null ? null : `$${(cents / 100).toFixed(2)}`;
  if (price && storeName) return `${price} at ${storeName}`;
  return price ?? storeName;
}

/**
 * Looks up each product row and the store behind the list's best price so the
 * list can show the catalog item, not the short word that was spoken.
 */
export async function catalogLinesForItems(items: ResolvedListItem[]): Promise<Map<string, CatalogLine>> {
  const lines = new Map<string, CatalogLine>();
  const productIds = [...new Set(items.map((item) => item.product_id).filter((id): id is string => Boolean(id)))];
  const shelfIds = [
    ...new Set(items.map((item) => item.best_store_product_id).filter((id): id is string => Boolean(id))),
  ];
  const products = productIds.length
    ? unwrap(
        await supabase
          .from('products')
          .select('id, name, brand, size_base_amount, size_base_unit')
          .in('id', productIds),
      )
    : [];
  const shelves = shelfIds.length
    ? unwrap(
        await supabase.from('store_products').select('id, stores(name)').in('id', shelfIds),
      )
    : [];
  const productById = new Map(products.map((row) => [row.id, row]));
  const storeByShelf = new Map(
    shelves.map((row) => {
      const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
      return [row.id, store?.name ?? null] as const;
    }),
  );
  for (const item of items) {
    const product = item.product_id ? productById.get(item.product_id) : undefined;
    const title = product
      ? formatCatalogTitle(product)
      : (item.display_name ?? item.custom_name ?? 'Item');
    const storeName = item.best_store_product_id ? (storeByShelf.get(item.best_store_product_id) ?? null) : null;
    lines.set(item.id, {
      title,
      offer: formatOffer(item.best_price_cents, storeName),
    });
  }
  return lines;
}

/** Open list row for this product, if one is already on the list. */
export async function openProductOnList(
  listId: string,
  productId: string,
): Promise<{ id: string; quantity: number } | null> {
  const rows = unwrap(
    await supabase
      .from('list_items')
      .select('id, quantity')
      .eq('list_id', listId)
      .eq('product_id', productId)
      .is('done_at', null)
      .order('created_at', { ascending: true })
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, quantity: Number(row.quantity) };
}

function openItemKey(item: Pick<ListItem, 'product_id' | 'category_id' | 'custom_name' | 'done_at'>): string | null {
  if (item.done_at) {
    return null;
  }
  if (item.product_id) {
    return `p:${item.product_id}`;
  }
  if (item.category_id) {
    return `c:${item.category_id}`;
  }
  const name = item.custom_name?.trim().toLowerCase();
  return name ? `n:${name}` : null;
}

/** The caller's personal group and its default grocery list. */
export async function getDefaultGroceryList(): Promise<{ group: Group; list: GroceryList }> {
  const groups = await listMyGroups();
  const group = groups.find((row) => row.kind === 'personal') ?? groups[0];
  if (!group) {
    // Guests and brand-new sessions have no group yet — not a user-facing failure.
    missingListError('No grocery group yet. Sign in again after signup finishes.');
  }
  const lists = await listGroupLists(group.id);
  const list = lists.find((row) => row.is_default) ?? lists[0];
  if (!list) {
    missingListError('This group has no grocery list.');
  }
  return { group, list };
}

/**
 * Raw list rows (no price or display-name view). Names can be filled in later
 * with listResolvedItems.
 */
export async function listListItems(listId: string): Promise<ListItem[]> {
  return unwrap(
    await supabase.from('list_items').select('*').eq('list_id', listId).order('created_at'),
  );
}

/**
 * Adds staples (habits) and optional recipe ingredients to a list.
 * Pass listId to target the active group list; otherwise uses the personal default.
 * Skips a target that already has an open row. Does not use listResolvedItems.
 */
export async function buildStandardList(input?: {
  listId?: string;
  recipeIds?: string[];
}): Promise<number> {
  let group: Group;
  let list: GroceryList;
  if (input?.listId) {
    list = unwrapOne(
      await supabase.from('lists').select('*').eq('id', input.listId).maybeSingle(),
      'List not found.',
    );
    group = unwrapOne(
      await supabase.from('groups').select('*').eq('id', list.group_id).maybeSingle(),
      'Group not found for that list.',
    );
  } else {
    ({ group, list } = await getDefaultGroceryList());
  }
  const existing = await listListItems(list.id);
  const keys = new Set(
    existing.map(openItemKey).filter((key): key is string => key != null),
  );

  let added = 0;
  const habits = await listHabits(group.id);
  for (const habit of habits) {
    if (!habit.auto_add_enabled || !habit.product_id) {
      continue;
    }
    const candidate = {
      product_id: habit.product_id,
      category_id: null,
      custom_name: null,
      done_at: null,
    };
    const key = openItemKey(candidate);
    if (!key || keys.has(key)) {
      continue;
    }
    await addListItem({
      listId: list.id,
      productId: habit.product_id,
      amountBase: habit.usual_amount_base ?? undefined,
    });
    keys.add(key);
    added += 1;
  }

  for (const recipeId of input?.recipeIds ?? []) {
    const ingredients = unwrap(
      await supabase.from('recipe_ingredients').select('*').eq('recipe_id', recipeId),
    );
    for (const ingredient of ingredients) {
      const productId = await productIdForIngredient(ingredient);
      if (!productId) continue;
      const candidate = {
        product_id: productId,
        category_id: null,
        custom_name: null,
        done_at: null,
      };
      const key = openItemKey(candidate);
      if (!key || keys.has(key)) {
        continue;
      }
      await addListItem({
        listId: list.id,
        productId,
        amountBase: ingredient.amount_base ?? undefined,
        sourceRecipeId: recipeId,
      });
      keys.add(key);
      added += 1;
    }
  }

  await addDueHabitItems();
  return added;
}

/**
 * Copies a recipe onto a list as real products. An ingredient with no matching
 * active product is skipped.
 */
export async function addRecipeToList(input: { listId: string; recipeId: string }): Promise<number> {
  const ingredients = unwrap(
    await supabase.from('recipe_ingredients').select('*').eq('recipe_id', input.recipeId),
  );
  let added = 0;
  for (const ingredient of ingredients) {
    const productId = await productIdForIngredient(ingredient);
    if (!productId) continue;
    await addListItem({
      listId: input.listId,
      productId,
      amountBase: ingredient.amount_base ?? undefined,
      sourceRecipeId: input.recipeId,
    });
    added += 1;
  }
  return added;
}

const RECIPE_LINE_NOISE = new Set([
  'tbsp',
  'tsp',
  'cup',
  'cups',
  'ounce',
  'ounces',
  'pound',
  'pounds',
  'clove',
  'cloves',
  'large',
  'small',
  'medium',
  'unsalted',
  'salted',
  'fresh',
  'dried',
  'chopped',
  'diced',
  'sliced',
  'softened',
  'optional',
  'taste',
  'and',
  'the',
]);

/** Prefer an exact product name, otherwise the shortest name that contains the term. */
async function productMatchingName(term: string): Promise<{ id: string; name: string } | null> {
  const cleaned = term.replace(/[%_,]/g, '').trim();
  if (cleaned.length < 2) return null;
  const rows = unwrap(
    await supabase
      .from('products')
      .select('id, name')
      .eq('is_active', true)
      .ilike('name', `%${cleaned}%`)
      .limit(20),
  );
  if (rows.length === 0) return null;
  const needle = cleaned.toLowerCase();
  const exact = rows.find((row) => row.name.trim().toLowerCase() === needle);
  if (exact) return exact;
  return [...rows].sort((a, b) => a.name.length - b.name.length)[0] ?? null;
}

/** Stored product, or one more search from the raw ingredient line. */
async function productForIngredient(
  ingredient: Pick<RecipeIngredient, 'product_id' | 'raw_text'>,
): Promise<{ id: string; name: string } | null> {
  if (ingredient.product_id) {
    const stored = await supabase
      .from('products')
      .select('id, name')
      .eq('id', ingredient.product_id)
      .eq('is_active', true)
      .maybeSingle();
    if (stored.error) fail(stored.error, 'Could not load the matched product.');
    if (stored.data) return stored.data;
  }
  const fromLine = await productMatchingName(ingredient.raw_text);
  if (fromLine) return fromLine;
  const words = ingredient.raw_text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !RECIPE_LINE_NOISE.has(word) && !/^\d+$/.test(word));
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  if (!longest || longest === ingredient.raw_text.trim().toLowerCase()) return null;
  return productMatchingName(longest);
}

async function productIdForIngredient(
  ingredient: Pick<RecipeIngredient, 'product_id' | 'raw_text'>,
): Promise<string | null> {
  const match = await productForIngredient(ingredient);
  return match?.id ?? null;
}
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pantryMatchForIngredient(
  ingredient: RecipeIngredient,
  pantry: Awaited<ReturnType<typeof listActivePantryItems>>,
): Awaited<ReturnType<typeof listActivePantryItems>>[number] | null {
  if (ingredient.category_id) {
    const byCategory = pantry.find((row) => row.categoryId === ingredient.category_id);
    if (byCategory) return byCategory;
  }
  const needle = normalizeName(ingredient.raw_text);
  if (!needle) return null;
  return (
    pantry.find((row) => {
      const name = normalizeName(row.productName);
      return name.includes(needle) || needle.includes(name);
    }) ?? null
  );
}

/**
 * Preview which recipe ingredients would be added vs skipped because the
 * household still has them (active pantry) or they are already on the open list.
 */
export async function previewRecipeForList(
  recipeId: string,
  target?: ActiveListTarget,
): Promise<RecipeListPreview> {
  const { group, list } = target ?? (await getDefaultGroceryList());
  const recipe = unwrapOne<{ id: string; title: string }>(
    await supabase.from('recipes').select('id, title').eq('id', recipeId).maybeSingle(),
    'Recipe not found.',
  );
  const ingredients = unwrap(
    await supabase.from('recipe_ingredients').select('*').eq('recipe_id', recipeId),
  );
  const [existing, pantry] = await Promise.all([
    listListItems(list.id),
    listActivePantryItems(group.id),
  ]);
  const openKeys = new Set(
    existing.map(openItemKey).filter((key): key is string => key != null),
  );

  const willAdd: RecipeListPreviewLine[] = [];
  const skipped: RecipeListPreviewLine[] = [];

  for (const ingredient of ingredients) {
    const product = await productForIngredient(ingredient);
    const line: RecipeListPreviewLine = {
      ingredientId: ingredient.id,
      label: product?.name ?? ingredient.raw_text,
      categoryId: ingredient.category_id,
      productId: product?.id ?? null,
      amountBase: ingredient.amount_base,
    };
    if (!product) {
      skipped.push({ ...line, reason: 'not_in_catalog' });
      continue;
    }
    const candidate = {
      product_id: product.id,
      category_id: null,
      custom_name: null,
      done_at: null as string | null,
    };
    const key = openItemKey(candidate);
    if (key && openKeys.has(key)) {
      skipped.push({ ...line, reason: 'already_on_list' });
      continue;
    }
    const pantryHit = pantryMatchForIngredient(ingredient, pantry);
    if (pantryHit) {
      skipped.push({
        ...line,
        reason: 'still_have',
        lastPurchasedAt: pantryHit.purchasedAt,
        expiresOn: pantryHit.expiresOn,
      });
      continue;
    }
    willAdd.push(line);
  }

  return { recipeId: recipe.id, title: recipe.title, willAdd, skipped };
}

/**
 * Adds recipe ingredients with purchase caution. By default only lines from
 * previewRecipeForList.willAdd are inserted. Pass forceIngredientIds to also
 * add skipped “still have” / already-on-list rows the user chose.
 */
export async function addRecipeToListWithCaution(input: {
  listId?: string;
  target?: ActiveListTarget;
  recipeId: string;
  forceIngredientIds?: string[];
}): Promise<{ added: number; skipped: number }> {
  const { list } = input.target ?? (await getDefaultGroceryList());
  const listId = input.listId ?? list.id;
  const preview = await previewRecipeForList(input.recipeId, input.target);
  const force = new Set(input.forceIngredientIds ?? []);
  const toAdd = [
    ...preview.willAdd,
    ...preview.skipped.filter(
      (row) => row.reason !== 'not_in_catalog' && force.has(row.ingredientId),
    ),
  ];

  const existing = await listListItems(listId);
  const keys = new Set(
    existing.map(openItemKey).filter((key): key is string => key != null),
  );

  let added = 0;
  for (const line of toAdd) {
    if (!line.productId || line.reason === 'not_in_catalog') continue;
    const candidate = {
      product_id: line.productId,
      category_id: null,
      custom_name: null,
      done_at: null as string | null,
    };
    const key = openItemKey(candidate);
    if (key && keys.has(key)) continue;
    await addListItem({
      listId,
      productId: line.productId,
      amountBase: line.amountBase ?? undefined,
      sourceRecipeId: input.recipeId,
    });
    if (key) keys.add(key);
    added += 1;
  }

  return { added, skipped: preview.skipped.length };
}
