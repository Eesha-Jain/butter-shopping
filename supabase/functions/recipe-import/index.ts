import { json, requireUser, userClient } from '../_shared/supabase.ts';

/**
 * Imports a recipe from pasted text, a URL (JSON-LD preferred), or a photo.
 * Parses ingredients with Grok tool-calling (XAI_API_KEY stays server-side).
 *
 * POST JSON:
 *   { mode: "text", text: string, title?: string }
 *   { mode: "url", url: string }
 *   { mode: "image", imageBase64: string, contentType?: string }
 *
 * Returns { recipeId, title, sourceUrl, ingredients: [...] }.
 */

const XAI_MODEL = 'grok-4.20-0309-non-reasoning';
const XAI_VISION_MODEL = Deno.env.get('XAI_VISION_MODEL') ?? 'grok-2-vision-1212';

const SET_INGREDIENTS_TOOL = {
  type: 'function',
  function: {
    name: 'set_ingredients',
    description: 'Structured recipe title and grocery ingredients extracted from the source.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short recipe title.' },
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rawText: {
                type: 'string',
                description: 'Original ingredient line, e.g. "2 tbsp unsalted butter, softened".',
              },
              canonicalName: {
                type: 'string',
                description: 'Short grocery category name, e.g. "butter", "whole milk", "eggs".',
              },
              amountBase: {
                type: 'number',
                description: 'Optional amount in a simple base unit (grams, ml, or count).',
              },
              unit: {
                type: 'string',
                description: 'Optional unit hint: g, ml, or ct.',
              },
            },
            required: ['rawText', 'canonicalName'],
          },
        },
      },
      required: ['title', 'ingredients'],
    },
  },
} as const;

type ParsedIngredient = {
  rawText: string;
  canonicalName: string;
  amountBase: number | null;
  unit: string | null;
};

type ParsedRecipe = {
  title: string;
  ingredients: ParsedIngredient[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecipeType(typeValue: unknown): boolean {
  return asArray(typeValue).some((t) => String(t).toLowerCase() === 'recipe');
}

function extractJsonLdRecipes(html: string): { name?: string; recipeIngredient?: unknown }[] {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const recipes: { name?: string; recipeIngredient?: unknown }[] = [];
  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = asArray(parsed).flatMap((node) => {
        if (node && typeof node === 'object' && '@graph' in (node as object)) {
          return asArray((node as { '@graph'?: unknown })['@graph']);
        }
        return [node];
      });
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const obj = node as { '@type'?: unknown; name?: string; recipeIngredient?: unknown };
        if (isRecipeType(obj['@type'])) recipes.push(obj);
      }
    } catch {
      // ignore malformed blocks
    }
  }
  return recipes;
}

function jsonLdIngredientLines(recipe: { recipeIngredient?: unknown }): string[] {
  return asArray(recipe.recipeIngredient).flatMap((line) => {
    if (typeof line === 'string') return [line.trim()].filter(Boolean);
    if (line && typeof line === 'object') {
      const obj = line as { text?: string; name?: string };
      const text = (obj.text ?? obj.name ?? '').trim();
      return text ? [text] : [];
    }
    return [];
  });
}

async function grokParseRecipe(input: {
  xaiKey: string;
  userContent: unknown;
  systemExtra?: string;
  model?: string;
}): Promise<ParsedRecipe> {
  const completion = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.xaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model ?? XAI_MODEL,
      temperature: 0,
      max_tokens: 1200,
      tools: [SET_INGREDIENTS_TOOL],
      tool_choice: { type: 'function', function: { name: 'set_ingredients' } },
      messages: [
        {
          role: 'system',
          content:
            'You extract a cooking recipe into set_ingredients. ' +
            'canonicalName must be a short grocery shopping name (category-like), not a brand. ' +
            'Keep rawText close to the source line. Skip non-food equipment. ' +
            (input.systemExtra ?? ''),
        },
        { role: 'user', content: input.userContent as string | object[] },
      ],
    }),
  });
  if (!completion.ok) {
    const errText = await completion.text().catch(() => '');
    console.error('[recipe-import] Grok failed:', completion.status, errText);
    throw new Response(JSON.stringify({ error: `Recipe parse failed (${completion.status}).` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const payload = (await completion.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { function?: { name?: string; arguments?: string } }[];
      };
    }[];
  };
  const message = payload.choices?.[0]?.message;
  const call = message?.tool_calls?.find((t) => t.function?.name === 'set_ingredients');
  if (!call?.function?.arguments) {
    console.warn(
      '[recipe-import] Missing set_ingredients tool_calls; trying message.content fallback',
    );
  }

  function normalizeArgs(args: {
    title?: string;
    ingredients?: {
      rawText?: string;
      canonicalName?: string;
      amountBase?: number;
      unit?: string;
    }[];
  }): ParsedRecipe {
    return {
      title: (args.title ?? 'Imported recipe').trim() || 'Imported recipe',
      ingredients: (args.ingredients ?? [])
        .map((row) => ({
          rawText: String(row.rawText ?? '').trim(),
          canonicalName: String(row.canonicalName ?? '').trim(),
          amountBase: typeof row.amountBase === 'number' && row.amountBase > 0 ? row.amountBase : null,
          unit: row.unit ? String(row.unit) : null,
        }))
        .filter((row) => row.rawText && row.canonicalName),
    };
  }

  let parsed: ParsedRecipe = { title: 'Imported recipe', ingredients: [] };
  try {
    if (call?.function?.arguments) {
      parsed = normalizeArgs(JSON.parse(call.function.arguments) as Parameters<typeof normalizeArgs>[0]);
    }
  } catch {
    parsed = { title: 'Imported recipe', ingredients: [] };
  }

  // Some Grok responses put JSON in content instead of tool_calls.
  if (parsed.ingredients.length === 0 && typeof message?.content === 'string') {
    const raw = message.content.trim();
    const jsonSlice = raw.startsWith('{')
      ? raw
      : (raw.match(/\{[\s\S]*"ingredients"[\s\S]*\}/)?.[0] ?? '');
    if (jsonSlice) {
      try {
        const fromContent = normalizeArgs(JSON.parse(jsonSlice) as Parameters<typeof normalizeArgs>[0]);
        if (fromContent.ingredients.length > 0) parsed = fromContent;
      } catch {
        // keep empty / tool-call parse
      }
    }
  }

  return parsed;
}

async function resolveCategoryId(
  supabase: ReturnType<typeof userClient>,
  canonicalName: string,
): Promise<string | null> {
  const term = canonicalName.replace(/[%_,]/g, '').trim();
  if (!term) return null;
  const exact = await supabase
    .from('product_categories')
    .select('id, name')
    .ilike('name', term)
    .limit(1)
    .maybeSingle();
  if (exact.data?.id) return exact.data.id;
  const fuzzy = await supabase
    .from('product_categories')
    .select('id, name')
    .ilike('name', `%${term}%`)
    .limit(1)
    .maybeSingle();
  return fuzzy.data?.id ?? null;
}

async function persistRecipe(input: {
  supabase: ReturnType<typeof userClient>;
  userId: string;
  title: string;
  sourceUrl?: string | null;
  ingredients: ParsedIngredient[];
}): Promise<{
  recipeId: string;
  title: string;
  sourceUrl: string | null;
  ingredients: {
    id: string;
    rawText: string;
    canonicalName: string;
    categoryId: string | null;
    amountBase: number | null;
  }[];
}> {
  if (input.sourceUrl) {
    const existing = await input.supabase
      .from('recipes')
      .select('id, title, source_url')
      .eq('source_url', input.sourceUrl)
      .maybeSingle();
    if (existing.data?.id) {
      const rows = await input.supabase
        .from('recipe_ingredients')
        .select('id, raw_text, category_id, amount_base')
        .eq('recipe_id', existing.data.id);
      return {
        recipeId: existing.data.id,
        title: existing.data.title,
        sourceUrl: existing.data.source_url,
        ingredients: (rows.data ?? []).map((row) => ({
          id: row.id,
          rawText: row.raw_text,
          canonicalName: row.raw_text,
          categoryId: row.category_id,
          amountBase: row.amount_base,
        })),
      };
    }
  }

  const created = await input.supabase
    .from('recipes')
    .insert({
      title: input.title.slice(0, 200),
      source_url: input.sourceUrl ?? null,
      created_by: input.userId,
      is_public: false,
    })
    .select('id, title, source_url')
    .maybeSingle();
  if (created.error || !created.data) {
    console.error('[recipe-import] recipe insert failed', created.error?.message);
    throw new Response(JSON.stringify({ error: 'Could not save the recipe.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const saved: {
    id: string;
    rawText: string;
    canonicalName: string;
    categoryId: string | null;
    amountBase: number | null;
  }[] = [];

  for (const ingredient of input.ingredients) {
    const categoryId = await resolveCategoryId(input.supabase, ingredient.canonicalName);
    const inserted = await input.supabase
      .from('recipe_ingredients')
      .insert({
        recipe_id: created.data.id,
        raw_text: ingredient.rawText.slice(0, 500),
        category_id: categoryId,
        amount_base: ingredient.amountBase,
      })
      .select('id, raw_text, category_id, amount_base')
      .maybeSingle();
    if (inserted.error || !inserted.data) {
      console.error('[recipe-import] ingredient insert failed', inserted.error?.message);
      continue;
    }
    saved.push({
      id: inserted.data.id,
      rawText: inserted.data.raw_text,
      canonicalName: ingredient.canonicalName,
      categoryId: inserted.data.category_id,
      amountBase: inserted.data.amount_base,
    });
  }

  return {
    recipeId: created.data.id,
    title: created.data.title,
    sourceUrl: created.data.source_url,
    ingredients: saved,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);

    const xaiKey = Deno.env.get('XAI_API_KEY');
    if (!xaiKey) return json({ error: 'XAI_API_KEY is not configured.' }, 503);

    const user = await requireUser(req);
    const supabase = userClient(req);
    const body = (await req.json().catch(() => ({}))) as {
      mode?: string;
      text?: string;
      title?: string;
      url?: string;
      imageBase64?: string;
      contentType?: string;
    };

    const mode = (body.mode ?? 'text').toLowerCase();
    let parsed: ParsedRecipe;
    let sourceUrl: string | null = null;

    if (mode === 'text') {
      const text = (body.text ?? '').trim();
      if (!text) return json({ error: 'Paste a recipe to import.' }, 400);
      if (text.length > 20_000) return json({ error: 'Recipe text is too long.' }, 400);
      parsed = await grokParseRecipe({
        xaiKey,
        userContent: text,
        systemExtra: body.title ? `Preferred title hint: ${body.title}.` : '',
      });
      if (body.title?.trim()) parsed.title = body.title.trim();
    } else if (mode === 'url') {
      const url = (body.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) return json({ error: 'A valid http(s) recipe URL is required.' }, 400);
      sourceUrl = url;
      const pageRes = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'butter-shopping/1.0 (+recipe-import)',
        },
        redirect: 'follow',
      });
      if (!pageRes.ok) {
        return json({ error: `Could not fetch that recipe page (${pageRes.status}).` }, 502);
      }
      const html = await pageRes.text();
      const ldRecipes = extractJsonLdRecipes(html);
      const lines = ldRecipes.flatMap(jsonLdIngredientLines);
      if (lines.length > 0) {
        const titleHint = ldRecipes[0]?.name ? String(ldRecipes[0].name) : '';
        parsed = await grokParseRecipe({
          xaiKey,
          userContent:
            `Normalize these schema.org recipe ingredients.\nTitle: ${titleHint || 'Unknown'}\n` +
            lines.map((line) => `- ${line}`).join('\n'),
          systemExtra: 'Ingredients came from JSON-LD; preserve meaning and set good canonicalName values.',
        });
        if (titleHint && parsed.title === 'Imported recipe') parsed.title = titleHint;
      } else {
        const text = stripHtml(html).slice(0, 15_000);
        if (!text) return json({ error: 'That page had no readable recipe text.' }, 422);
        parsed = await grokParseRecipe({
          xaiKey,
          userContent: text,
          systemExtra: 'Extract the main recipe only; ignore ads and comments.',
        });
      }
    } else if (mode === 'image') {
      const imageBase64 = (body.imageBase64 ?? '').trim();
      if (!imageBase64) return json({ error: 'imageBase64 is required.' }, 400);
      const contentType = body.contentType ?? 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        return json({ error: 'Only image uploads are supported right now. Take a photo of the recipe.' }, 400);
      }
      parsed = await grokParseRecipe({
        xaiKey,
        model: XAI_VISION_MODEL,
        userContent: [
          {
            type: 'text',
            text: 'Read this recipe photo and extract the title and grocery ingredients.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${contentType};base64,${imageBase64}` },
          },
        ],
      });
    } else {
      return json({ error: 'mode must be text, url, or image.' }, 400);
    }

    if (parsed.ingredients.length === 0) {
      return json({ error: 'No ingredients found in that recipe.' }, 422);
    }

    const result = await persistRecipe({
      supabase,
      userId: user.id,
      title: parsed.title,
      sourceUrl,
      ingredients: parsed.ingredients,
    });

    return json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[recipe-import]', error);
    return json({ error: error instanceof Error ? error.message : 'Recipe import failed.' }, 500);
  }
});
