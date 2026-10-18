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
 *      fuzzy nearest that the shopper has favorited or bought before → auto-add
 *      that one and announce it; other fuzzy nearest → suggestions to confirm;
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
        language: {
          type: 'string',
          description: 'ISO 639-1 code of the language the user spoke, e.g. "en", "es", "zh".',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description:
                  'One grocery item, short and in English, e.g. "whole milk" or "potato". ' +
                    'Keep a phrase that might be one dish or two foods as one name, like "banana pudding". ' +
                    'Separate foods stay separate: "bananas potatoes eggs" is three names.',
              },
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

type SplitChoice = {
  phrase: string;
  one: Suggestion | null;
  two: Suggestion[];
};

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
  historyNote?: string | null;
  productId?: string;
  listItemId?: string;
};

type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  size_base_amount: number | null;
  size_base_unit: string | null;
};

/** Brand, name, and pack size from the catalog row, not the short spoken word. */
function catalogTitle(product: CatalogProduct): string {
  const brand = product.brand?.trim();
  const name = product.name.trim();
  const titled = brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
  const amount = Number(product.size_base_amount);
  if (Number.isFinite(amount) && amount > 0 && product.size_base_unit) {
    return `${titled}, ${amount} ${product.size_base_unit}`;
  }
  return titled;
}

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

/** ElevenLabs marks non-speech as tags like "[outro jingle]". Those must not be parsed or spoken. */
function stripAudioTags(value: string): string {
  return value.replace(/\s*\[[^\]\n]{1,80}\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (item.historyNote) line += ` ${item.historyNote}`;
  return line;
}

/** Mic checks and chatter. These are not products, even when a real food sits beside them. */
const NOISE_WORDS = new Set([
  'testing',
  'test',
  'hello',
  'hi',
  'hey',
  'check',
  'mic',
  'audio',
]);

/** A grocery count: a number word, or a digit from 1 to 24. "123" is a mic check, not a quantity. */
function spokenQuantity(word: string): number | null {
  if (NUMBER_WORDS[word] != null) return NUMBER_WORDS[word];
  if (!/^\d{1,2}$/.test(word)) return null;
  const n = Number(word);
  if (n < 1 || n > 24) return null;
  return n;
}

function isNoiseName(name: string): boolean {
  const words = name.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return words.length === 0 || words.every((word) => NOISE_WORDS.has(word) || /^\d+$/.test(word));
}

function keepGroceryItems(items: ParsedItem[]): ParsedItem[] {
  return items.filter((item) => item.name.trim() && !isNoiseName(item.name));
}

/** A one-time note can pick one dish or two foods. It is not saved. */
function clarificationSide(note: string): 'one' | 'two' | null {
  const words = note.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const two = words.some((word) => word === 'both' || word === 'two' || word === 'separate' || word === 'separately');
  const one = words.some(
    (word) => word === 'one' || word === 'single' || word === 'together' || word === 'dessert' || word === 'dish',
  );
  if (two && !one) return 'two';
  if (one && !two) return 'one';
  return null;
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

/** Closest catalog row for one spoken name. */
function bestCatalogHit(term: string, rows: CatalogProduct[], quantity: number): Suggestion | null {
  if (rows.length === 0) return null;
  const ranked = [...rows].sort((a, b) => closenessScore(a.name, term) - closenessScore(b.name, term));
  const best = ranked[0]!;
  return { name: term, quantity, productId: best.id, label: catalogTitle(best) };
}

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

/** One closest catalog suggestion for each food the shopper named. */
function pickClosestSuggestions(candidates: Suggestion[], termByLabel: Map<string, string>): Suggestion[] {
  const bestByItem = new Map<string, { suggestion: Suggestion; score: number; order: number }>();
  let order = 0;
  for (const suggestion of candidates) {
    const term = termByLabel.get(suggestion.label) ?? suggestion.name;
    const score = closenessScore(suggestion.label, term);
    const key = suggestion.name.trim().toLowerCase();
    const existing = bestByItem.get(key);
    if (!existing) {
      bestByItem.set(key, { suggestion, score, order: order++ });
    } else if (score < existing.score) {
      bestByItem.set(key, { suggestion, score, order: existing.order });
    }
  }
  return [...bestByItem.values()]
    .sort((a, b) => a.order - b.order)
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
    .replace(/\b(please|thanks|thank you|add|get|buy|i need|i want|can i get|grab|i meant|meant|instead|actually)\b/g, ' ')
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
    const leading = spokenQuantity(first);
    if (leading != null) {
      quantity = leading;
      nameStart = 1;
    }

    const name = words.slice(nameStart).join(' ').trim();
    if (!name) continue;
    items.push({ name, quantity });
  }

  return explodeItems(items);
}

/**
 * Second word of a phrase that might be one dish or two foods.
 * "banana pudding" can be the dessert, or a banana and pudding.
 */
const DISH_HEADS = new Set([
  'pudding',
  'pie',
  'soup',
  'salad',
  'bread',
  'cake',
  'stew',
  'chili',
  'dip',
  'sandwich',
  'noodles',
  'pasta',
  'casserole',
  'muffin',
  'cookie',
  'brownie',
  'tart',
  'cobbler',
  'parfait',
  'smoothie',
]);

/** Words Scribe otherwise drops. Sent as repeated keyterms, one field per word. */
const HEARD_FOODS = ['potato', 'potatoes', 'sweet potato', 'pudding', 'banana', 'bananas'];

const COMPOUND_FOODS = new Set([
  'olive oil',
  'peanut butter',
  'ice cream',
  'whole milk',
  'sour cream',
  'green onion',
  'bell pepper',
  'soy sauce',
  'hot sauce',
  'orange juice',
  'apple juice',
  'paper towel',
  'toilet paper',
  'ground beef',
  'chicken breast',
  'cream cheese',
  'maple syrup',
  'brown sugar',
  'baking soda',
  'baking powder',
  'coconut milk',
  'almond milk',
  'oat milk',
  'black bean',
  'green bean',
  'sweet potato',
]);

/** "bananas potatoes eggs" is three items. Real two-word foods stay together. */
function explodeItems(items: ParsedItem[]): ParsedItem[] {
  const out: ParsedItem[] = [];
  for (const item of items) {
    const words = item.name.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (words.length <= 1) {
      out.push(item);
      continue;
    }
    let i = 0;
    while (i < words.length) {
      const word = words[i]!;
      const qty = spokenQuantity(word);
      if (qty != null) {
        i += 1;
        if (i >= words.length) break;
      }
      const pair = words[i + 1]
        ? `${normalizeToken(words[i]!)} ${normalizeToken(words[i + 1]!)}`
        : '';
      const head = words[i + 1] ? normalizeToken(words[i + 1]!) : '';
      if (pair && (COMPOUND_FOODS.has(pair) || DISH_HEADS.has(head))) {
        out.push({ name: `${words[i]} ${words[i + 1]}`, quantity: qty ?? item.quantity });
        i += 2;
        continue;
      }
      out.push({ name: words[i]!, quantity: qty ?? item.quantity });
      i += 1;
    }
  }
  return out.length > 0 ? out : items;
}

function parseGrokCall(payload: {
  choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
}): { items: ParsedItem[]; language: string | null } {
  const call = payload.choices?.[0]?.message?.tool_calls?.find((t) => t.function?.name === 'add_items');
  try {
    const args = JSON.parse(call?.function?.arguments ?? '{"items":[]}') as {
      language?: string;
      items?: { name: string; quantity?: number }[];
    };
    const language = typeof args.language === 'string' ? args.language.toLowerCase().slice(0, 2) : null;
    const items = (args.items ?? []).map((item) => ({
      name: String(item.name),
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    }));
    return { items, language: language && /^[a-z]{2}$/.test(language) ? language : null };
  } catch {
    return { items: [], language: null };
  }
}

/** Best-effort language of the shopper's words when Grok did not report one. */
function detectLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  const lower = text.toLowerCase();
  if (/\b(quiero|necesito|por favor|huevos|leche|y)\b/.test(lower) && /\b(el|la|los|las|un|una)\b/.test(lower)) {
    return 'es';
  }
  if (/\b(je|veux|voudrais|du|des|lait|oeufs|œuf|s'il)\b/.test(lower)) return 'fr';
  if (/\b(ich|bitte|milch|eier|möchte)\b/.test(lower)) return 'de';
  if (/\b(quero|preciso|leite|ovos|por favor)\b/.test(lower)) return 'pt';
  if (/\b(tôi|muốn|trứng|sữa)\b/.test(lower)) return 'vi';
  return 'en';
}

/**
 * Grocery English is often labeled Spanish. Leave English unless the words
 * themselves are clearly another language.
 */
function confirmSpokenLanguage(transcript: string, grokLanguage: string | null): string {
  const fromWords = detectLanguage(transcript);
  if (fromWords !== 'en') return fromWords;
  if (!grokLanguage || grokLanguage === 'en') return 'en';
  return 'en';
}

type ReplyPhrases = {
  added: string;
  skipped: string;
  notProduct: string;
};

const ENGLISH_PHRASES: ReplyPhrases = {
  added: 'Added {quantity} {label}.',
  skipped: 'Okay, rejected.',
  notProduct: 'That is not a real product, so it was not added.',
};

/** Rewrites the reply and short confirmations into the shopper's language. */
async function localizeAssistantText(
  xaiKey: string | undefined,
  language: string,
  reply: string,
): Promise<{ reply: string; phrases: ReplyPhrases }> {
  if (!xaiKey || language === 'en') return { reply, phrases: ENGLISH_PHRASES };
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
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              `Rewrite these grocery-assistant lines into ISO 639-1 language "${language}". ` +
              'Speak as "I", never "we". Keep product names, store names, prices, and numbers unchanged. ' +
              'Return only JSON with keys reply, added, skipped, notProduct. ' +
              'The added value must keep the exact placeholders {quantity} and {label}.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              reply,
              added: ENGLISH_PHRASES.added,
              skipped: ENGLISH_PHRASES.skipped,
              notProduct: ENGLISH_PHRASES.notProduct,
            }),
          },
        ],
      }),
    });
    if (!completion.ok) return { reply, phrases: ENGLISH_PHRASES };
    const payload = (await completion.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content ?? '';
    const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText) as Partial<ReplyPhrases> & { reply?: string };
    const added = parsed.added?.includes('{quantity}') && parsed.added.includes('{label}')
      ? parsed.added
      : ENGLISH_PHRASES.added;
    return {
      reply: parsed.reply?.trim() || reply,
      phrases: {
        added,
        skipped: parsed.skipped?.trim() || ENGLISH_PHRASES.skipped,
        notProduct: parsed.notProduct?.trim() || ENGLISH_PHRASES.notProduct,
      },
    };
  } catch (err) {
    console.error('[voice-order] localize failed:', err);
    return { reply, phrases: ENGLISH_PHRASES };
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
    let clarifyNote = '';
    let usedClarification = false;

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}) as { transcript?: string; clarify?: string });
      transcript = (body.transcript ?? '').trim();
      clarifyNote = (body.clarify ?? '').trim();
      console.log('[voice-order] typed transcript:', transcript);
    } else {
      const form = await req.formData().catch(() => null);
      const audio = form?.get('audio');
      if (!audio || !(audio instanceof File)) {
        return json({ error: 'A multipart "audio" file field is required.' }, 400);
      }

      const audioBytes = new Uint8Array(await audio.arrayBuffer());
      const transcribe = (useKeyterms: boolean) => {
        const scribeForm = new FormData();
        const clip = new File([audioBytes], audio.name || 'clip.m4a', { type: audio.type || 'audio/m4a' });
        scribeForm.set('file', clip, clip.name);
        scribeForm.set('model_id', 'scribe_v2');
        scribeForm.set('tag_audio_events', 'false');
        if (useKeyterms) {
          for (const term of HEARD_FOODS) scribeForm.append('keyterms', term);
        }
        return fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: { 'xi-api-key': elevenKey },
          body: scribeForm,
        });
      };

      let scribeRes = await transcribe(true);
      if (!scribeRes.ok && (scribeRes.status === 400 || scribeRes.status === 422)) {
        const errText = await scribeRes.text().catch(() => '');
        console.error('[voice-order] Scribe keyterms rejected:', scribeRes.status, errText);
        scribeRes = await transcribe(false);
      }
      if (!scribeRes.ok) {
        const errText = await scribeRes.text().catch(() => '');
        console.error('[voice-order] Scribe failed:', scribeRes.status, errText);
        if (scribeRes.status === 400 || scribeRes.status === 422) {
          return json({
            transcript: '',
            reply: "I can't hear anything.",
            language: 'en',
            phrases: ENGLISH_PHRASES,
            added: [],
            suggestions: [],
            replyAudioBase64: null,
          });
        }
        return json({ error: `Transcription failed (${scribeRes.status}).` }, 502);
      }
      const scribePayload = (await scribeRes.json()) as { text?: string };
      transcript = (scribePayload.text ?? '').trim();
      let context = (req.headers.get('x-butter-context') ?? '').trim();
      if (context) {
        try {
          context = decodeURIComponent(context).trim();
        } catch {
          context = context.trim();
        }
        clarifyNote = transcript;
        transcript = context;
        usedClarification = true;
      }
      console.log('[voice-order] spoken transcript:', transcript, context ? '(one-time clarification)' : '');
    }

    transcript = stripAudioTags(transcript);
    clarifyNote = stripAudioTags(clarifyNote).slice(0, 240);
    if (clarifyNote && transcript.endsWith(clarifyNote) && transcript.length > clarifyNote.length) {
      transcript = transcript.slice(0, transcript.length - clarifyNote.length).trim();
    }
    if (clarifyNote) usedClarification = true;
    const shownTranscript = transcript;
    const localSource = clarifyNote ? `${shownTranscript}. ${clarifyNote}` : shownTranscript;
    const grokUser = clarifyNote
      ? `${shownTranscript}\nOne-time clarification, use it only for this request and then forget it: ${clarifyNote}`
      : shownTranscript;
    if (!shownTranscript) {
      return json({
        transcript: '',
        reply: "I can't hear anything.",
        language: 'en',
        phrases: ENGLISH_PHRASES,
        added: [],
        suggestions: [],
        replyAudioBase64: null,
      });
    }
    if (transcript.length > 500) return json({ error: 'Transcript too long.' }, 400);

    // --- 1. Ask Grok (with local parser fallback on failure) -------------
    let items: ParsedItem[] = [];
    let language = detectLanguage(transcript);

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
                  'Set language to the ISO 639-1 code of the language the user used. Use "en" for English. ' +
                  'Do not mark English as Spanish just because a word looks similar. ' +
                  'Each food is its own item. "I want bananas potatoes eggs" is three items: bananas, potatoes, eggs. ' +
                  'Keep real two-word foods together, like "olive oil" or "peanut butter". ' +
                  'If a phrase could be one dish or two foods, like "banana pudding", keep that full phrase as one item name. ' +
                  'Always keep "potato" and "potatoes" as an item. ' +
                  'Keep item names short, generic, and in English. ' +
                  'Ignore mic-check words such as "testing", "hello", and "check". ' +
                  'A number is a quantity only when it is a small count directly before a food. "123" is not a quantity. ' +
                  '"testing testing 123 potato" is one item: potato. ' +
                  'If the only words are not foods, call add_items with an empty items array.' +
                  (clarifyNote
                    ? ' A one-time clarification is included. Use it only to resolve this request, then forget it. Do not treat it as a saved preference.'
                    : ''),
              },
              { role: 'user', content: grokUser },
            ],
          }),
        });
        if (!completion.ok) {
          const errText = await completion.text().catch(() => '');
          console.error('[voice-order] Grok request failed:', completion.status, errText);
          items = parseTranscriptLocally(localSource);
          console.log('[voice-order] using local parser after Grok', completion.status, JSON.stringify(items));
        } else {
          const completionPayload = (await completion.json()) as {
            choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
          };
          console.log('[voice-order] grok raw:', JSON.stringify(completionPayload));
          const parsed = parseGrokCall(completionPayload);
          items = explodeItems(parsed.items);
          language = confirmSpokenLanguage(transcript, parsed.language);
          if (items.length === 0) {
            items = parseTranscriptLocally(localSource);
            if (items.length > 0) {
              console.log('[voice-order] Grok empty; local parser:', JSON.stringify(items));
            }
          }
        }
      } catch (err) {
        console.error('[voice-order] Grok threw:', err);
        items = parseTranscriptLocally(localSource);
        console.log('[voice-order] using local parser after Grok throw:', JSON.stringify(items));
      }
    } else {
      console.warn('[voice-order] XAI_API_KEY missing; using local parser');
      items = parseTranscriptLocally(localSource);
    }

    items = keepGroceryItems(items);
    const clarifySide = clarificationSide(clarifyNote);
    if (clarifySide === 'two') {
      items = items.flatMap((item) => {
        const words = item.name.split(/\s+/).filter(Boolean);
        const pairKey = words.length === 2 ? `${normalizeToken(words[0]!)} ${normalizeToken(words[1]!)}` : '';
        if (!pairKey || COMPOUND_FOODS.has(pairKey)) return [item];
        return words.map((name) => ({ name, quantity: item.quantity }));
      });
    }
    console.log('[voice-order] parsed items:', JSON.stringify(items), 'language:', language);
    if (items.length === 0) {
      const empty = await localizeAssistantText(
        xaiKey,
        language,
        "I didn't hear a grocery item. Name a food, like eggs or potatoes.",
      );
      return json({
        transcript: shownTranscript,
        ...(usedClarification ? { heard: clarifyNote } : {}),
        reply: empty.reply,
        language,
        phrases: empty.phrases,
        added: [],
        suggestions: [],
        confused: true,
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
    const already: {
      name: string;
      productId: string;
      listItemId: string;
      existingQuantity: number;
      addQuantity: number;
    }[] = [];
    const fuzzyCandidates: Suggestion[] = [];
    const fuzzyTermByLabel = new Map<string, string>();
    const unmatched: { name: string; quantity: number }[] = [];
    const splits: SplitChoice[] = [];

    async function catalogRows(term: string): Promise<CatalogProduct[]> {
      const safe = term.replace(/[%_]/g, '').trim();
      if (!safe) return [];
      const products = await supabase
        .from('products')
        .select('id, name, brand, size_base_amount, size_base_unit')
        .eq('is_active', true)
        .or(`name.ilike.%${safe}%,brand.ilike.%${safe}%`)
        .limit(8);
      return (products.data ?? []) as CatalogProduct[];
    }

    const preferredStores = await supabase.from('user_stores').select('store_id').eq('user_id', user.id);
    const preferredStoreIds = new Set((preferredStores.data ?? []).map((row) => row.store_id as string));

    const favoriteRows = await supabase
      .from('product_favorites')
      .select('product_id')
      .eq('user_id', user.id);
    const favoriteIds = new Set((favoriteRows.data ?? []).map((row) => row.product_id as string));

    const purchaseRows = await supabase
      .from('purchases')
      .select('store_product_id, purchased_at')
      .eq('user_id', user.id)
      .order('purchased_at', { ascending: false })
      .limit(80);
    const boughtShelfIds = [
      ...new Set((purchaseRows.data ?? []).map((row) => row.store_product_id as string)),
    ];
    const boughtShelves = boughtShelfIds.length
      ? await supabase.from('store_products').select('id, product_id').in('id', boughtShelfIds)
      : { data: [] as { id: string; product_id: string }[] };
    const productByShelf = new Map(
      (boughtShelves.data ?? []).map((row) => [row.id as string, row.product_id as string]),
    );
    const lastPurchasedAt = new Map<string, string>();
    for (const row of purchaseRows.data ?? []) {
      const productId = productByShelf.get(row.store_product_id as string);
      if (!productId || lastPurchasedAt.has(productId)) continue;
      lastPurchasedAt.set(productId, row.purchased_at as string);
    }

    function historyNoteFor(productId: string): string | null {
      if (favoriteIds.has(productId)) return "I chose it because you've favorited it.";
      if (lastPurchasedAt.has(productId)) return "I chose it because you've bought it before.";
      return null;
    }

    function rememberedFirst(candidates: CatalogProduct[]): CatalogProduct[] {
      const remembered = candidates.filter(
        (row) => favoriteIds.has(row.id) || lastPurchasedAt.has(row.id),
      );
      return remembered.length > 0 ? remembered : candidates;
    }

    /**
     * Prefer a product the shopper has favorited, then one they have bought.
     * Otherwise pick a preferred store, then the lowest current shelf price.
     * Does not create products.
     */
    async function chooseProduct(
      candidates: CatalogProduct[],
    ): Promise<{
      product: CatalogProduct;
      storeName: string | null;
      priceCents: number | null;
      historyNote: string | null;
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
        historyRank: number;
        purchasedAt: string;
      };
      const offers: Offer[] = shelfRows.map((row) => {
        const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
        return {
          product: byProduct.get(row.product_id)!,
          storeName: store?.name ?? null,
          priceCents: priceByShelf.get(row.id) ?? null,
          preferred: preferredStoreIds.has(row.store_id),
          historyRank: favoriteIds.has(row.product_id) ? 0 : lastPurchasedAt.has(row.product_id) ? 1 : 2,
          purchasedAt: lastPurchasedAt.get(row.product_id) ?? '',
        };
      }).filter((row) => row.product);

      const priced = offers.filter((row) => row.priceCents != null);
      const remembered = priced.filter((row) => row.historyRank < 2);
      const preferred = priced.filter((row) => row.preferred);
      const pool = (remembered.length > 0 ? remembered : preferred.length > 0 ? preferred : priced)
        .slice()
        .sort((a, b) => {
          if (a.historyRank !== b.historyRank) return a.historyRank - b.historyRank;
          if (a.historyRank === 1 && a.purchasedAt !== b.purchasedAt) {
            return b.purchasedAt.localeCompare(a.purchasedAt);
          }
          if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
          return (a.priceCents ?? 0) - (b.priceCents ?? 0);
        });
      if (pool[0]) {
        return {
          product: pool[0].product,
          storeName: pool[0].storeName,
          priceCents: pool[0].priceCents,
          historyNote: historyNoteFor(pool[0].product.id),
        };
      }
      const fallback = rememberedFirst(candidates)[0]!;
      return {
        product: fallback,
        storeName: null,
        priceCents: null,
        historyNote: historyNoteFor(fallback.id),
      };
    }

    async function addChosenProduct(requestedQty: number, choice: {
      product: CatalogProduct;
      storeName: string | null;
      priceCents: number | null;
      historyNote: string | null;
    }): Promise<boolean> {
      const packs = packsToAdd(
        requestedQty,
        choice.product.size_base_amount,
        choice.product.size_base_unit,
      );
      const title = catalogTitle(choice.product);
      const existing = await supabase
        .from('list_items')
        .select('id, quantity')
        .eq('list_id', list.data.id)
        .eq('product_id', choice.product.id)
        .is('done_at', null)
        .order('created_at', { ascending: true })
        .limit(1);
      const existingRow = existing.data?.[0];
      if (existingRow) {
        already.push({
          name: title,
          productId: choice.product.id,
          listItemId: existingRow.id,
          existingQuantity: Number(existingRow.quantity),
          addQuantity: packs.quantity,
        });
        return true;
      }
      const insert = {
        list_id: list.data.id,
        added_by: user.id,
        quantity: packs.quantity,
        product_id: choice.product.id,
      };
      const inserted = await supabase.from('list_items').insert(insert).select('id').maybeSingle();
      if (inserted.error) {
        console.error('[voice-order] insert failed for', choice.product.name, inserted.error.message);
        return false;
      }
      added.push({
        name: title,
        quantity: packs.quantity,
        matched: 'product',
        storeName: choice.storeName,
        priceCents: choice.priceCents,
        packNote: packs.packNote,
        historyNote: choice.historyNote,
        productId: choice.product.id,
        listItemId: inserted.data?.id,
      });
      return true;
    }

    for (const item of items) {
      const term = item.name.replace(/[%_]/g, '').trim();
      if (!term) continue;

      const words = term.toLowerCase().split(/\s+/).filter(Boolean);
      const pairKey = words.length === 2 ? `${normalizeToken(words[0]!)} ${normalizeToken(words[1]!)}` : '';
      if (clarifySide !== 'one' && words.length === 2 && pairKey && !COMPOUND_FOODS.has(pairKey)) {
        const head = normalizeToken(words[1]!);
        const [phraseRows, leftRows, rightRows] = await Promise.all([
          catalogRows(term),
          catalogRows(words[0]!),
          catalogRows(words[1]!),
        ]);
        const oneHit = bestCatalogHit(term, phraseRows, item.quantity);
        const two = [words[0]!, words[1]!]
          .map((word, index) => bestCatalogHit(word, index === 0 ? leftRows : rightRows, item.quantity))
          .filter((row): row is Suggestion => row != null);
        const couldBeOne = DISH_HEADS.has(head) || phraseRows.length > 0;
        if (couldBeOne && (oneHit || two.length === 2)) {
          splits.push({ phrase: `${words[0]} ${words[1]}`, one: oneHit, two });
          continue;
        }
      }

      const products = await supabase
        .from('products')
        .select('id, name, brand, size_base_amount, size_base_unit')
        .eq('is_active', true)
        .or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
        .limit(8);

      const productRows = (products.data ?? []) as CatalogProduct[];
      const strongProducts = productRows.filter((row) => isStrongMatch(row.name, term));
      const fuzzyProducts = productRows.filter((row) => !isStrongMatch(row.name, term));

      if (strongProducts.length > 0) {
        const choice = await chooseProduct(strongProducts);
        if (choice && (await addChosenProduct(item.quantity, choice))) continue;
        unmatched.push({ name: item.name, quantity: item.quantity });
        continue;
      }

      const categories = await supabase
        .from('product_categories')
        .select('id, name')
        .ilike('name', `%${term}%`)
        .limit(5);
      const categoryRows = categories.data ?? [];
      const strongCategories = categoryRows.filter((row) => isStrongMatch(row.name, term));

      if (strongCategories.length > 0) {
        const inCategory = await supabase
          .from('products')
          .select('id, name, brand, size_base_amount, size_base_unit')
          .eq('is_active', true)
          .eq('category_id', strongCategories[0]!.id)
          .limit(12);
        const choice = await chooseProduct((inCategory.data ?? []) as CatalogProduct[]);
        if (choice && (await addChosenProduct(item.quantity, choice))) continue;
      }

      const remembered = fuzzyProducts.filter(
        (row) => favoriteIds.has(row.id) || lastPurchasedAt.has(row.id),
      );
      if (remembered.length > 0) {
        const choice = await chooseProduct(remembered);
        if (choice && (await addChosenProduct(item.quantity, choice))) continue;
      }

      const nearest: Suggestion[] = fuzzyProducts.map((row) => ({
        name: item.name,
        quantity: item.quantity,
        productId: row.id,
        label: catalogTitle(row),
      }));

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
    console.log('[voice-order] splits:', JSON.stringify(splits));

    const replyParts: string[] = [];
    if (splits.length) {
      replyParts.push(
        splits
          .map((split) => {
            const parts = split.two.map((item) => item.label).join(' and ');
            return parts
              ? `${split.phrase} could be one item, or ${parts}. Say one or both.`
              : `${split.phrase} could be one item or two. Say one or both.`;
          })
          .join(' '),
      );
    }
    if (added.length) {
      replyParts.push(added.map((item) => formatAddedLine(item)).join(' '));
    }
    if (already.length) {
      replyParts.push(
        already
          .map(
            (item) =>
              `'${item.name}' is already on your list. Add ${item.addQuantity} more to that line?`,
          )
          .join(' '),
      );
    }
    if (suggestions.length === 1) {
      const asked = suggestions[0]!;
      replyParts.push(
        `Closest is '${asked.label}'. Say yes to add it, or change the quantity.`,
      );
    } else if (suggestions.length > 1) {
      const asked = suggestions.map((item) => `${item.quantity} ${item.label}`).join(', ');
      replyParts.push(`Confirm each one: ${asked}. Say yes to add them all.`);
    }
    if (unmatched.length) {
      const asked = unmatched.map((u) => `${u.quantity} ${u.name}`).join(', ');
      replyParts.push(
        `Sorry, I was unable to find a close match for ${asked}. ` +
          `If you'd describe what you're looking for more clearly, I can try to find it.`,
      );
    }
    const englishReply = replyParts.length
      ? replyParts.join(' ')
      : "I heard you, but couldn't add anything to your list.";
    const localized = await localizeAssistantText(xaiKey, language, englishReply);
    const reply = stripAudioTags(localized.reply) || "I didn't catch that. You can change the quantity on the card.";

    // --- 4. Push the result back to the user's devices ---------------------
    const tokens = await supabase.from('push_tokens').select('token').eq('user_id', user.id);
    if ((tokens.data ?? []).length > 0) {
      const invalid = await sendExpoPush(
        (tokens.data ?? []).map((row) => ({ to: row.token, title: 'Butter', body: reply, sound: null })),
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

    const confused =
      splits.length > 0 ||
      unmatched.length > 0 ||
      (added.length === 0 && suggestions.length === 0 && already.length === 0);
    console.log('[voice-order] final reply:', reply, 'language:', language);
    return json({
      transcript: shownTranscript,
      ...(usedClarification ? { heard: clarifyNote } : {}),
      reply,
      englishReply,
      language,
      phrases: localized.phrases,
      added,
      already,
      suggestions,
      splits,
      confused,
      replyAudioBase64,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Voice order failed.' }, 500);
  }
});
