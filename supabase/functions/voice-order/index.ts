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
 *   3. Resolves each item's name against products, then product_categories,
 *      falling back to a custom_name line if nothing matches.
 *   4. Inserts the resolved lines into the caller's default list.
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
    description: "Add the grocery items the user asked for to their shopping list.",
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

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);

    const xaiKey = Deno.env.get('XAI_API_KEY');
    if (!xaiKey) return json({ error: 'XAI_API_KEY is not configured.' }, 503);
    const elevenKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!elevenKey) return json({ error: 'ELEVENLABS_API_KEY is not configured.' }, 503);

    const user = await requireUser(req);
    const supabase = userClient(req);

    // --- 0. Get a transcript, either typed directly (JSON) or spoken ------
    // Typed path: { "transcript": "two bananas" } as application/json — used
    // by the text-input fallback in the UI, and the fastest way to test the
    // parsing/Supabase/push steps without recording audio at all.
    // Spoken path: multipart/form-data with an "audio" file field — the
    // normal push-to-talk flow. Transcribed here with ElevenLabs Scribe
    // (plain REST upload, no WebRTC/secure-context requirement).
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

    // --- 1. Ask Grok to turn the transcript into a tool call -------------
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
      return json({ error: `Grok request failed (${completion.status}).` }, 502);
    }
    const completionPayload = (await completion.json()) as {
      choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
    };
    console.log('[voice-order] grok raw:', JSON.stringify(completionPayload));
    const call = completionPayload.choices?.[0]?.message?.tool_calls?.find(
      (t) => t.function?.name === 'add_items',
    );
    let items: { name: string; quantity: number }[] = [];
    try {
      const args = JSON.parse(call?.function?.arguments ?? '{"items":[]}') as {
        items?: { name: string; quantity?: number }[];
      };
      items = (args.items ?? []).map((item) => ({
        name: String(item.name),
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      }));
    } catch {
      items = [];
    }
    console.log('[voice-order] parsed items:', JSON.stringify(items));
    if (items.length === 0) {
      return json({ transcript, reply: "I didn't catch anything to add. Try again?", added: [] });
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

    // --- 3. Resolve each item and insert it --------------------------------
    const added: { name: string; quantity: number; matched: 'product' | 'category' | 'custom' }[] = [];
    for (const item of items) {
      const term = item.name.replace(/[%_]/g, '').trim();
      if (!term) continue;

      const product = await supabase
        .from('products')
        .select('id, name')
        .eq('is_active', true)
        .or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
        .limit(1)
        .maybeSingle();

      let insert: Record<string, unknown> = { list_id: list.data.id, added_by: user.id, quantity: item.quantity };
      let matched: 'product' | 'category' | 'custom' = 'custom';

      if (product.data) {
        insert = { ...insert, product_id: product.data.id };
        matched = 'product';
      } else {
        const category = await supabase
          .from('product_categories')
          .select('id, name')
          .ilike('name', `%${term}%`)
          .limit(1)
          .maybeSingle();
        if (category.data) {
          insert = { ...insert, category_id: category.data.id };
          matched = 'category';
        } else {
          insert = { ...insert, custom_name: item.name };
        }
      }

      const inserted = await supabase.from('list_items').insert(insert).select('id').maybeSingle();
      if (inserted.error) {
        console.error('[voice-order] insert failed for', item.name, inserted.error.message);
      } else {
        added.push({ name: item.name, quantity: item.quantity, matched });
      }
    }
    console.log('[voice-order] added:', JSON.stringify(added));

    const reply = added.length
      ? `Got it — added ${added.map((a) => `${a.quantity} ${a.name}`).join(', ')}.`
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
    // Best-effort: if this fails for any reason, we still return the text
    // reply and the client falls back to on-device TTS.
    let replyAudioBase64: string | null = null;
    try {
      const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID') ?? '21m00Tcm4TlvDq8ikWAM'; // "Rachel", a default public voice
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
    return json({ transcript, reply, added, replyAudioBase64 });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Voice order failed.' }, 500);
  }
});
