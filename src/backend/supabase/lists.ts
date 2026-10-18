import type { GroceryList, Group, ListItem, ResolvedListItem } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne, unwrapVoid } from './query';
import { listMyGroups } from './groups';
import { addDueHabitItems, listHabits } from './purchases';

/**
 * Lists in a group. Every group has one default list created with the group.
 */
export async function listGroupLists(groupId: string): Promise<GroceryList[]> {
  return unwrap(await supabase.from('lists').select('*').eq('group_id', groupId).order('created_at'));
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
    if (!habit.auto_add_enabled) {
      continue;
    }
    const candidate = {
      product_id: habit.product_id,
      category_id: habit.category_id,
      custom_name: null,
      done_at: null,
    };
    const key = openItemKey(candidate);
    if (!key || keys.has(key)) {
      continue;
    }
    await addListItem({
      listId: list.id,
      productId: habit.product_id ?? undefined,
      categoryId: habit.category_id ?? undefined,
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
      const candidate = {
        product_id: null,
        category_id: ingredient.category_id,
        custom_name: ingredient.category_id ? null : ingredient.raw_text,
        done_at: null,
      };
      const key = openItemKey(candidate);
      if (!key || keys.has(key)) {
        continue;
      }
      await addListItem({
        listId: list.id,
        categoryId: ingredient.category_id ?? undefined,
        customName: ingredient.category_id ? undefined : ingredient.raw_text,
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
