import { json, requireUser, sendExpoPush, userClient } from '../_shared/supabase.ts';

/**
 * Push-to-talk ordering.
 *
 * expo-speech-recognition requires a custom EAS dev client (it's a native
 * module not present in Expo Go), so for Expo Go compatibility the device
 * instead records plain audio with expo-audio and uploads the clip here as
 * multipart/form-data under the field name "audio".
 *
 * This function:
 *   1. Transcribes the clip with ElevenLabs Scribe (plain REST upload —
 *      no WebRTC/secure-context requirement, so it works fine called
 *      server-side like this even though the live ElevenLabs *agent*
 *      doesn't work in Expo Go).
 *   2. Sends the transcript to Grok (chat endpoint only, xAI) with a single
 *      tool, `add_items`, and asks it to call that tool with the grocery
 *      items it heard. Tool-calling keeps the output structured without
 *      relying on free-text JSON parsing. (Grok's Voice endpoint is NOT
 *      used — it's excluded from the hackathon credit tier.)
 *      If Grok fails (e.g. 402), falls back to a local qty+name parser.
 *   3. Resolves each item: strong product/category match → auto-add;
 *      fuzzy nearest only → return suggestions for client confirm;
 *      no catalog hit → polite "couldn't find a match" reply (nothing added).
 *   4. Inserts auto-resolved lines into the caller's default list.
 *   5. Sends an Expo push notification confirming what was added, and also
 *      returns the same summary in the response so the app can show/speak
 *      it immediately without waiting on the push.
 *
 *   6. Also generates a short spoken confirmation of the reply with
 *      ElevenLabs TTS and returns it as base64 mp3, so the app can play a
 *      natural voice instead of the OS's built-in TTS. Best-effort — if TTS
 *      fails, replyAudioBase64 is null and the client falls back silently.
 *
 * Requires two secrets:
 *   - ELEVENLABS_API_KEY  (Scribe transcription + TTS)
 *   - XAI_API_KEY         (Grok chat endpoint only — scope the key to "chat",
 *                           NOT "voice" — model "grok-4.20-0309-non-reasoning")
 * Optional secret:
 *   - ELEVENLABS_VOICE_ID (defaults to the public "Rachel" voice if unset)
 */

const XAI_MODEL = 'grok-4.20-0309-non-reasoning';

const ADD_ITEMS_TOOL = {
  type: 'function',
  function: {
    name: 'add_items',
    description: 'Add the grocery items the user asked for to their shopping list.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short generic item name, e.g. "whole milk".' },
              quantity: { type: 'integer', description: 'How many. Default to 1 if not said.' },
            },
            required: ['name'],
          },
        },
      },
      required: ['items'],
    },
  },
} as const;

type ParsedItem = { name: string; quantity: number };

type Suggestion = {
  name: string;
  quantity: number;
  productId?: string;
  categoryId?: string;
  customName?: string;
  label: string;
};

type AddedItem = {
  name: string;
  quantity: number;
  matched: 'product' | 'category' | 'custom';
  storeName?: string | null;
  priceCents?: number | null;
  packNote?: string | null;
};

type CatalogProduct = {
  id: string;
  name: string;
  size_base_amount: number | null;
  size_base_unit: string | null;
};

/**
 * A count pack already contains size_base_amount units (e.g. 12 eggs).
 * Asking for 12 of a 12-count pack adds 1 pack, not 12 packs.
 * Asking for fewer than a pack still adds 1 pack. Larger asks round up.
 */
function packsToAdd(
  requested: number,
  sizeAmount: number | null,
  sizeUnit: string | null,
): { quantity: number; packNote: string | null } {
  const pack = Number(sizeAmount);
  if (sizeUnit === 'ct' && Number.isFinite(pack) && pack > 1) {
    const packs = requested <= pack ? 1 : Math.ceil(requested / pack);
    if (packs !== requested) {
      const noun = packs === 1 ? 'pack' : 'packs';
      return {
        quantity: packs,
        packNote: `That's ${packs} ${pack}-count ${noun}, not ${requested} separate packs.`,
      };
    }
    return { quantity: packs, packNote: null };
  }
  return { quantity: requested, packNote: null };
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAddedLine(item: AddedItem): string {
  const qty = item.quantity > 1 ? `${item.quantity} × ` : '';
  let line = `I've added ${qty}'${item.name}' to your grocery list.`;
  const where: string[] = [];
  if (item.priceCents != null) where.push(formatMoney(item.priceCents));
  if (item.storeName) where.push(`at ${item.storeName}`);
  if (where.length) line += ` ${where.join(' ')}.`;
  if (item.packNote) line += ` ${item.packNote}`;
  return line;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
};

/** Strip trailing "s"/"es" for loose singular/plural compare. */
function normalizeToken(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower.endsWith('ies') && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith('es') && lower.length > 3) return lower.slice(0, -2);
  if (lower.endsWith('s') && lower.length > 2) return lower.slice(0, -1);
  return lower;
}

function normalizePhrase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(value: string): string[] {
  return normalizePhrase(value).split(' ').filter(Boolean).map(normalizeToken);
}

/**
 * Strong: normalized name equals the term, or the candidate's leading tokens
 * equal the term (e.g. "whole milk" → "Whole Milk 1gal"). Mid-name whole-word
 * hits (e.g. "eggs" inside "Large Grade A Eggs") are fuzzy nearest matches so
 * the client can confirm before adding.
 */
function isStrongMatch(candidateName: string, term: string): boolean {
  const cand = normalizePhrase(candidateName);
  const t = normalizePhrase(term);
  if (!cand || !t) return false;
  if (cand === t) return true;
  const candTokens = tokensOf(candidateName);
  const termTokens = tokensOf(term);
  if (termTokens.length === 0) return false;
  return candTokens.slice(0, termTokens.length).join(' ') === termTokens.join(' ');
}

/** Lower score = closer. Used to pick at most 3 fuzzy suggestions. */
function closenessScore(candidateName: string, term: string): number {
  const cand = normalizePhrase(candidateName);
  const t = normalizePhrase(term);
  if (!cand || !t) return 9999;
  if (cand === t) return 0;
  const candTokens = tokensOf(candidateName);
  const termTokens = tokensOf(term);
  const hasWholeWord = termTokens.every((tok) => candTokens.includes(tok));
  const index = cand.indexOf(t);
  const lengthPenalty = Math.abs(cand.length - t.length);
  const positionPenalty = index >= 0 ? index : 50;
  const wordBonus = hasWholeWord ? 0 : 25;
  const tokenExtra = Math.max(0, candTokens.length - termTokens.length) * 3;
  return lengthPenalty + positionPenalty + wordBonus + tokenExtra;
}

function suggestionDedupeKey(s: Suggestion): string {
  return s.productId ? `p:${s.productId}` : s.categoryId ? `c:${s.categoryId}` : `n:${s.label}`;
}

/** Keep the 3 closest unique catalog suggestions across the whole request. */
function pickClosestSuggestions(candidates: Suggestion[], termByLabel: Map<string, string>): Suggestion[] {
  const bestByKey = new Map<string, { suggestion: Suggestion; score: number }>();
  for (const suggestion of candidates) {
    const key = suggestionDedupeKey(suggestion);
    const term = termByLabel.get(suggestion.label) ?? suggestion.name;
    const score = closenessScore(suggestion.label, term);
    const existing = bestByKey.get(key);
    if (!existing || score < existing.score) {
      bestByKey.set(key, { suggestion, score });
    }
  }
  return [...bestByKey.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((row) => row.suggestion);
}

/**
 * Local fallback when Grok is unavailable (402, timeouts, etc.).
 * Handles "3 eggs", "1 egg", "two bananas", "milk", and comma-separated lists.
 */
function parseTranscriptLocally(transcript: string): ParsedItem[] {
  const cleaned = transcript
    .toLowerCase()
    .replace(/[.!?]+/g, ' ')
    .replace(/\b(please|thanks|thank you|add|get|buy|i need|i want|can i get|grab)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const chunks = cleaned.split(/\s*(?:,|\band\b)\s*/).map((c) => c.trim()).filter(Boolean);
  const items: ParsedItem[] = [];

  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let quantity = 1;
    let nameStart = 0;
    const first = words[0]!;
    const asNum = Number(first);
    if (Number.isFinite(asNum) && asNum > 0) {
      quantity = Math.floor(asNum);
      nameStart = 1;
    } else if (NUMBER_WORDS[first] != null) {
      quantity = NUMBER_WORDS[first]!;
      nameStart = 1;
    }

    const name = words.slice(nameStart).join(' ').trim();
    if (!name) continue;
    items.push({ name, quantity });
  }

  return items;
}

function parseGrokItems(payload: {
  choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
}): ParsedItem[] {
  const call = payload.choices?.[0]?.message?.tool_calls?.find((t) => t.function?.name === 'add_items');
  try {
    const args = JSON.parse(call?.function?.arguments ?? '{"items":[]}') as {
      items?: { name: string; quantity?: number }[];
    };
    return (args.items ?? []).map((item) => ({
      name: String(item.name),
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    }));
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);

    const xaiKey = Deno.env.get('XAI_API_KEY');
    const elevenKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!elevenKey) return json({ error: 'ELEVENLABS_API_KEY is not configured.' }, 503);

    const user = await requireUser(req);
    const supabase = userClient(req);

    // --- 0. Get a transcript, either typed directly (JSON) or spoken ------
    const contentType = req.headers.get('content-type') ?? '';
    let transcript: string;

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}) as { transcript?: string });
      transcript = (body.transcript ?? '').trim();
      console.log('[voice-order] typed transcript:', transcript);
    } else {
      const form = await req.formData().catch(() => null);
      const audio = form?.get('audio');
      if (!audio || !(audio instanceof File)) {
        return json({ error: 'A multipart "audio" file field is required.' }, 400);
      }

      const scribeForm = new FormData();
      scribeForm.set('file', audio, audio.name || 'clip.m4a');
      scribeForm.set('model_id', 'scribe_v1');

      const scribeRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': elevenKey },
        body: scribeForm,
      });
      if (!scribeRes.ok) {
        const errText = await scribeRes.text().catch(() => '');
        console.error('[voice-order] Scribe failed:', scribeRes.status, errText);
        return json({ error: `Transcription failed (${scribeRes.status}).` }, 502);
      }
      const scribePayload = (await scribeRes.json()) as { text?: string };
      transcript = (scribePayload.text ?? '').trim();
      console.log('[voice-order] spoken transcript:', transcript);
    }

    if (!transcript) return json({ error: "Didn't catch anything. Try again?" }, 400);
    if (transcript.length > 500) return json({ error: 'Transcript too long.' }, 400);

    // --- 1. Ask Grok (with local parser fallback on failure) -------------
    let items: ParsedItem[] = [];

    if (xaiKey) {
      try {
        const completion = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${xaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: XAI_MODEL,
            temperature: 0,
            max_tokens: 300,
            tools: [ADD_ITEMS_TOOL],
            tool_choice: { type: 'function', function: { name: 'add_items' } },
            messages: [
              {
                role: 'system',
                content:
                  'You turn a spoken grocery request into a call to add_items. ' +
                  'Keep names short and generic (e.g. "whole milk", not "a gallon of whole milk please"). ' +
                  'If nothing resembles a grocery item, call add_items with an empty items array.',
              },
              { role: 'user', content: transcript },
            ],
          }),
        });
        if (!completion.ok) {
          const errText = await completion.text().catch(() => '');
          console.error('[voice-order] Grok request failed:', completion.status, errText);
          items = parseTranscriptLocally(transcript);
          console.log('[voice-order] using local parser after Grok', completion.status, JSON.stringify(items));
        } else {
          const completionPayload = (await completion.json()) as {
            choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
          };
          console.log('[voice-order] grok raw:', JSON.stringify(completionPayload));
          items = parseGrokItems(completionPayload);
          if (items.length === 0) {
            items = parseTranscriptLocally(transcript);
            if (items.length > 0) {
              console.log('[voice-order] Grok empty; local parser:', JSON.stringify(items));
            }
          }
        }
      } catch (err) {
        console.error('[voice-order] Grok threw:', err);
        items = parseTranscriptLocally(transcript);
        console.log('[voice-order] using local parser after Grok throw:', JSON.stringify(items));
      }
    } else {
      console.warn('[voice-order] XAI_API_KEY missing; using local parser');
      items = parseTranscriptLocally(transcript);
    }

    console.log('[voice-order] parsed items:', JSON.stringify(items));
    if (items.length === 0) {
      return json({
        transcript,
        reply: "I didn't catch anything to add. Try again?",
        added: [],
        suggestions: [],
      });
    }

    // --- 2. Find the caller's default list --------------------------------
    const membership = await supabase.from('group_members').select('group_id').limit(1).maybeSingle();
    if (membership.error || !membership.data) return json({ error: 'You are not in a group yet.' }, 400);
    const list = await supabase
      .from('lists')
      .select('id')
      .eq('group_id', membership.data.group_id)
      .eq('is_default', true)
      .maybeSingle();
    if (list.error || !list.data) return json({ error: 'No default list found for your group.' }, 400);

    // --- 3. Resolve each item: strong → add, fuzzy → suggest (max 3), none → clarify
    const added: AddedItem[] = [];
    const fuzzyCandidates: Suggestion[] = [];
    const fuzzyTermByLabel = new Map<string, string>();
    const unmatched: { name: string; quantity: number }[] = [];

    const preferredStores = await supabase.from('user_stores').select('store_id').eq('user_id', user.id);
    const preferredStoreIds = new Set((preferredStores.data ?? []).map((row) => row.store_id as string));

    /**
     * Among real products, pick the one at a preferred store when possible,
     * otherwise the lowest current shelf price. Does not create products.
     */
    async function chooseProduct(
      candidates: CatalogProduct[],
    ): Promise<{
      product: CatalogProduct;
      storeName: string | null;
      priceCents: number | null;
    } | null> {
      if (candidates.length === 0) return null;
      const ids = candidates.map((row) => row.id);
      const shelf = await supabase
        .from('store_products')
        .select('id, store_id, product_id, stores(name)')
        .in('product_id', ids)
        .eq('is_available', true);
      const shelfRows = (shelf.data ?? []) as {
        id: string;
        store_id: string;
        product_id: string;
        stores: { name: string } | { name: string }[] | null;
      }[];
      const priceRows = shelfRows.length
        ? await supabase
            .from('current_prices')
            .select('store_product_id, price_cents')
            .in(
              'store_product_id',
              shelfRows.map((row) => row.id),
            )
        : { data: [] as { store_product_id: string; price_cents: number }[] };
      const priceByShelf = new Map(
        (priceRows.data ?? []).map((row) => [row.store_product_id, Number(row.price_cents)]),
      );
      const byProduct = new Map(candidates.map((row) => [row.id, row]));

      type Offer = {
        product: CatalogProduct;
        storeName: string | null;
        priceCents: number | null;
        preferred: boolean;
      };
      const offers: Offer[] = shelfRows.map((row) => {
        const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
        return {
          product: byProduct.get(row.product_id)!,
          storeName: store?.name ?? null,
          priceCents: priceByShelf.get(row.id) ?? null,
          preferred: preferredStoreIds.has(row.store_id),
        };
      }).filter((row) => row.product);

      const priced = offers.filter((row) => row.priceCents != null);
      const preferred = priced.filter((row) => row.preferred);
      const pool = (preferred.length > 0 ? preferred : priced).slice().sort(
        (a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0),
      );
      if (pool[0]) {
        return {
          product: pool[0].product,
          storeName: pool[0].storeName,
          priceCents: pool[0].priceCents,
        };
      }
      return { product: candidates[0]!, storeName: null, priceCents: null };
    }

    async function addChosenProduct(requestedQty: number, choice: {
      product: CatalogProduct;
      storeName: string | null;
      priceCents: number | null;
    }): Promise<void> {
      const packs = packsToAdd(
        requestedQty,
        choice.product.size_base_amount,
        choice.product.size_base_unit,
      );
      const insert = {
        list_id: list.data.id,
        added_by: user.id,
        quantity: packs.quantity,
        product_id: choice.product.id,
      };
      const inserted = await supabase.from('list_items').insert(insert).select('id').maybeSingle();
      if (inserted.error) {
        console.error('[voice-order] insert failed for', choice.product.name, inserted.error.message);
        return;
      }
      added.push({
        name: choice.product.name,
        quantity: packs.quantity,
        matched: 'product',
        storeName: choice.storeName,
        priceCents: choice.priceCents,
        packNote: packs.packNote,
      });
    }

    for (const item of items) {
      const term = item.name.replace(/[%_]/g, '').trim();
      if (!term) continue;

      const products = await supabase
        .from('products')
        .select('id, name, size_base_amount, size_base_unit')
        .eq('is_active', true)
        .or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
        .limit(8);

      const productRows = (products.data ?? []) as CatalogProduct[];
      const strongProducts = productRows.filter((row) => isStrongMatch(row.name, term));
      const fuzzyProducts = productRows.filter((row) => !isStrongMatch(row.name, term));

      if (strongProducts.length > 0) {
        const choice = await chooseProduct(strongProducts);
        if (choice) await addChosenProduct(item.quantity, choice);
        continue;
      }

      const categories = await supabase
        .from('product_categories')
        .select('id, name')
        .ilike('name', `%${term}%`)
        .limit(5);
      const categoryRows = categories.data ?? [];
      const strongCategories = categoryRows.filter((row) => isStrongMatch(row.name, term));
      const fuzzyCategories = categoryRows.filter((row) => !isStrongMatch(row.name, term));

      if (strongCategories.length > 0) {
        const inCategory = await supabase
          .from('products')
          .select('id, name, size_base_amount, size_base_unit')
          .eq('is_active', true)
          .eq('category_id', strongCategories[0]!.id)
          .limit(12);
        const choice = await chooseProduct((inCategory.data ?? []) as CatalogProduct[]);
        if (choice) {
          await addChosenProduct(item.quantity, choice);
          continue;
        }
      }

      const nearest: Suggestion[] = [
        ...fuzzyProducts.map((row) => ({
          name: item.name,
          quantity: item.quantity,
          productId: row.id,
          label: row.name,
        })),
        ...fuzzyCategories.map((row) => ({
          name: item.name,
          quantity: item.quantity,
          categoryId: row.id,
          label: row.name,
        })),
      ];

      if (nearest.length > 0) {
        for (const suggestion of nearest) {
          fuzzyTermByLabel.set(suggestion.label, term);
          fuzzyCandidates.push(suggestion);
        }
        continue;
      }

      // No catalog hit → do not add; ask the user to describe it more clearly
      unmatched.push({ name: item.name, quantity: item.quantity });
    }

    const suggestions = pickClosestSuggestions(fuzzyCandidates, fuzzyTermByLabel);

    console.log('[voice-order] added:', JSON.stringify(added));
    console.log('[voice-order] suggestions:', JSON.stringify(suggestions));
    console.log('[voice-order] unmatched:', JSON.stringify(unmatched));

    const replyParts: string[] = [];
    if (added.length) {
      replyParts.push(added.map((item) => formatAddedLine(item)).join(' '));
    }
    if (suggestions.length) {
      const uniqueLabels = [...new Set(suggestions.map((s) => s.label))];
      const asked = suggestions[0]!;
      replyParts.push(
        `I couldn't add exactly ${asked.quantity} ${asked.name}. Closest: ${uniqueLabels.join(', ')}. Add that?`,
      );
    }
    if (unmatched.length) {
      const asked = unmatched.map((u) => `${u.quantity} ${u.name}`).join(', ');
      replyParts.push(
        `Sorry, we were unable to find a close match for ${asked}. ` +
          `If you'd describe what you're looking for more clearly, we can try to find it.`,
      );
    }
    const reply = replyParts.length
      ? replyParts.join(' ')
      : "I heard you, but couldn't add anything to your list.";

    // --- 4. Push the result back to the user's devices ---------------------
    const tokens = await supabase.from('push_tokens').select('token').eq('user_id', user.id);
    if ((tokens.data ?? []).length > 0) {
      const invalid = await sendExpoPush(
        (tokens.data ?? []).map((row) => ({ to: row.token, title: 'Butter', body: reply })),
      );
      if (invalid.length > 0) await supabase.from('push_tokens').delete().in('token', invalid);
    }

    // --- 5. Speak the confirmation back with ElevenLabs TTS -----------------
    let replyAudioBase64: string | null = null;
    try {
      const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID') ?? '21m00Tcm4TlvDq8ikWAM';
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': elevenKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: reply,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        },
      );
      if (ttsRes.ok) {
        const bytes = new Uint8Array(await ttsRes.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        replyAudioBase64 = btoa(binary);
      }
    } catch {
      replyAudioBase64 = null;
    }

    console.log('[voice-order] final reply:', reply);
    return json({ transcript, reply, added, suggestions, replyAudioBase64 });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Voice order failed.' }, 500);
  }
});
