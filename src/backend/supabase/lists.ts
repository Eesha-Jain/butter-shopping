import type { GroceryList, Group, ListItem, ResolvedListItem } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne, unwrapVoid } from './query';
import { listMyGroups } from './groups';

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
 * Adds one thing to buy. Supply exactly one of productId, categoryId, or customName.
 * amountBase is measured in the category's g, ml, or ct unit. A category item is
 * resolved to a real product later by the shopping plan.
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
  const targets = [input.productId, input.categoryId, input.customName].filter(Boolean);
  if (targets.length !== 1) {
    fail('A list item needs exactly one of a product, a category, or a custom name.');
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

/**
 * Copies a recipe's ingredient categories onto a list. Each ingredient becomes
 * a category item, not a specific brand. Ingredients without a category are
 * stored as custom names so the original line is not lost.
 */
export async function addRecipeToList(input: { listId: string; recipeId: string }): Promise<number> {
  const ingredients = unwrap(
    await supabase.from('recipe_ingredients').select('*').eq('recipe_id', input.recipeId),
  );
  let added = 0;
  for (const ingredient of ingredients) {
    await addListItem({
      listId: input.listId,
      categoryId: ingredient.category_id ?? undefined,
      customName: ingredient.category_id ? undefined : ingredient.raw_text,
      amountBase: ingredient.amount_base ?? undefined,
      sourceRecipeId: input.recipeId,
    });
    added += 1;
  }
  return added;
}
