import type { Recipe, RecipeDetail, RecipeIngredient, TrendingRow } from '../types';
import { supabase } from './client';
import { fail } from '../errors';
import { unwrap, unwrapOne } from './query';

export type ImportedRecipeIngredient = {
  id: string;
  rawText: string;
  canonicalName: string;
  categoryId: string | null;
  amountBase: number | null;
};

export type ImportedRecipe = {
  recipeId: string;
  title: string;
  sourceUrl: string | null;
  ingredients: ImportedRecipeIngredient[];
};

type RecipeImportResponse = ImportedRecipe & { error?: string };

async function invokeRecipeImport(body: Record<string, unknown>): Promise<ImportedRecipe> {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !anonKey) fail('Could not import that recipe.');

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) fail('Sign in required.');

  // Raw fetch so 4xx/5xx JSON `{ error }` reaches the toast (invoke often masks it).
  const response = await fetch(`${baseUrl}/functions/v1/recipe-import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as RecipeImportResponse | null;
  if (!response.ok || !data || data.error) {
    fail(data?.error ?? 'Could not import that recipe.');
  }
  if (!data.recipeId) fail('Recipe import did not return a recipe id.');
  return {
    recipeId: data.recipeId,
    title: data.title,
    sourceUrl: data.sourceUrl ?? null,
    ingredients: data.ingredients ?? [],
  };
}

/** Paste plain recipe text; Edge Function parses with Grok and saves ingredients. */
export async function importRecipeFromText(input: {
  text: string;
  title?: string;
}): Promise<ImportedRecipe> {
  return invokeRecipeImport({
    mode: 'text',
    text: input.text,
    title: input.title,
  });
}

/** Fetch a recipe URL (JSON-LD when available), parse, and save. */
export async function importRecipeFromUrl(url: string): Promise<ImportedRecipe> {
  return invokeRecipeImport({ mode: 'url', url });
}

/** Send a recipe photo (base64, no data-URL prefix) for vision parse + save. */
export async function importRecipeFromImage(input: {
  imageBase64: string;
  contentType?: string;
}): Promise<ImportedRecipe> {
  return invokeRecipeImport({
    mode: 'image',
    imageBase64: input.imageBase64,
    contentType: input.contentType ?? 'image/jpeg',
  });
}

/**
 * Trending feed for a campus. Organic rows have a score. Sponsored rows have a
 * null score and must be labeled Sponsored. A sponsored placement is not added
 * to the organic purchase count. Null collegeId on a sponsored row means it is
 * shown to every campus.
 */
export async function listTrending(collegeId?: string | null): Promise<TrendingRow[]> {
  const rows = unwrap(await supabase.from('v_trending').select('*'));
  if (!collegeId) return rows;
  return rows.filter((row) => row.college_id === null || row.college_id === collegeId);
}

/** Public recipes plus recipes created by the caller. */
export async function listVisibleRecipes(): Promise<Recipe[]> {
  return unwrap(await supabase.from('recipes').select('*').order('created_at', { ascending: false }));
}

/** One recipe and its ingredient lines, including a rough shelf-price estimate. */
export async function getRecipeDetail(recipeId: string): Promise<RecipeDetail[]> {
  return unwrap(await supabase.from('v_recipe_detail').select('*').eq('recipe_id', recipeId));
}

/**
 * Creates a private recipe owned by the caller. Set isPublic true only when
 * the author wants it on the shared recipe list. Imported web recipes should
 * keep the source URL and omit copied instructions.
 */
export async function createRecipe(input: {
  title: string;
  sourceUrl?: string;
  videoUrl?: string;
  instructions?: string;
  servings?: number;
  isPublic?: boolean;
}): Promise<Recipe> {
  const user = await supabase.auth.getUser();
  if (!user.data.user) fail('Sign in before writing a recipe.');
  return unwrapOne(
    await supabase
      .from('recipes')
      .insert({
        title: input.title,
        source_url: input.sourceUrl ?? null,
        video_url: input.videoUrl ?? null,
        instructions: input.instructions ?? null,
        servings: input.servings ?? null,
        created_by: user.data.user.id,
        is_public: input.isPublic ?? false,
      })
      .select('*')
      .maybeSingle(),
    'Recipe insert did not return a row.',
  );
}

/**
 * Adds an ingredient line. categoryId is the shopping category, such as flour.
 * It is not a brand or a store product. rawText keeps the original wording.
 */
export async function addRecipeIngredient(input: {
  recipeId: string;
  rawText: string;
  categoryId?: string;
  amountBase?: number;
}): Promise<RecipeIngredient> {
  return unwrapOne(
    await supabase
      .from('recipe_ingredients')
      .insert({
        recipe_id: input.recipeId,
        raw_text: input.rawText,
        category_id: input.categoryId ?? null,
        amount_base: input.amountBase ?? null,
      })
      .select('*')
      .maybeSingle(),
    'Ingredient insert did not return a row.',
  );
}
