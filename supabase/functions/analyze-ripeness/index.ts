import { json, requireUser } from '../_shared/supabase.ts';

type RipenessLabel = 'underripe' | 'ripe' | 'overripe' | 'unknown';

/**
 * Judges one produce photo and returns a ripeness label. The image is not
 * written to Storage or the database. VISION_API_URL and VISION_API_KEY must
 * point at an OpenAI-compatible chat completions endpoint that accepts an
 * image_url content part. The response is constrained to four labels.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
    await requireUser(req);
    const { imageBase64, contentType = 'image/jpeg', productHint } = await req.json() as {
      imageBase64?: string;
      contentType?: string;
      productHint?: string;
    };
    if (!imageBase64) return json({ error: 'imageBase64 is required.' }, 400);
    const apiUrl = Deno.env.get('VISION_API_URL');
    const apiKey = Deno.env.get('VISION_API_KEY');
    if (!apiUrl || !apiKey) {
      return json({ error: 'The ripeness vision provider is not configured.' }, 503);
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Classify this ${productHint ?? 'fruit or vegetable'} as underripe, ripe, overripe, or unknown. Reply with JSON {"label":"...","confidence":0,"note":"..."}.`,
            },
            { type: 'image_url', image_url: { url: `data:${contentType};base64,${imageBase64}` } },
          ],
        }],
      }),
    });
    if (!response.ok) return json({ error: 'The vision provider rejected the image.' }, 502);
    const payload = await response.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as { label?: RipenessLabel; confidence?: number; note?: string };
    const label = parsed.label && ['underripe', 'ripe', 'overripe', 'unknown'].includes(parsed.label)
      ? parsed.label
      : 'unknown';
    return json({
      label,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      note: parsed.note ?? '',
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Ripeness analysis failed.' }, 500);
  }
});
