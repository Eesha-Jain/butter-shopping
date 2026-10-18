import type { GroceryList, Group, ListItem, ResolvedListItem } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne, unwrapVoid } from './query';
import { listMyGroups } from './groups';
import { addDueHabitItems, listHabits } from './purchases';

export type ActiveListTarget = {
  group: Group;
  list: GroceryList;
};

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
  fail('No grocery list found. New accounts receive a personal list at signup.');
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
  const user = await supabase.auth.getUser();
  return unwrapOne(
    await supabase
      .from('list_items')
      .insert({
        list_id: input.listId,
        added_by: user.data.user?.id ?? null,
        product_id: input.productId ?? null,
        category_id: input.categoryId ?? null,
        custom_name: input.customName ?? null,
        quantity: input.quantity ?? 1,
        amount_base: input.amountBase ?? null,
        size_flexible: input.sizeFlexible ?? true,
        source_recipe_id: input.sourceRecipeId ?? null,
      })
      .select('*')
      .maybeSingle(),
    'List item insert did not return a row.',
  );
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
    fail('No grocery group yet. Sign in again after signup finishes.');
  }
  const lists = await listGroupLists(group.id);
  const list = lists.find((row) => row.is_default) ?? lists[0];
  if (!list) {
    fail('This group has no grocery list.');
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
 * Adds staples (habits) and optional recipe ingredients to the default list.
 * Skips a target that already has an open row. Does not use listResolvedItems.
 */
export async function buildStandardList(input?: { recipeIds?: string[] }): Promise<number> {
  const { group, list } = await getDefaultGroceryList();
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
      const productId = await productIdForIngredient(ingredient.category_id);
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
    const productId = await productIdForIngredient(ingredient.category_id);
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

/** First active catalog product in a recipe ingredient's category, if any. */
async function productIdForIngredient(categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const product = await supabase
    .from('products')
    .select('id')
    .eq('is_active', true)
    .eq('category_id', categoryId)
    .limit(1)
    .maybeSingle();
  return product.data?.id ?? null;
}
