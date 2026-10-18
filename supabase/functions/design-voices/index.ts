import { json, requireServiceRole } from '../_shared/supabase.ts';

/**
 * One-shot voice design. Call with the service role, then copy the voice ids
 * into voice-order. Not used by the app.
 *
 * POST {} 
 */

type Designed = { name: string; voiceId: string };

const VOICES: { name: string; description: string; text: string }[] = [
  {
    name: 'Butter Female',
    description:
      'A warm American woman in her late twenties talking to a friend in the kitchen. Close-mic, natural breath, soft smile, mid pitch, easy conversational pace. Clear but not announcer-like. Real human cadence with small pitch lifts, not a synthetic assistant.',
    text: 'Hey, do you want whole milk? I can add it, or you can tell me if you meant something else. Just say yes if that sounds right.',
  },
  {
    name: 'Butter Male',
    description:
      'A friendly American man in his early thirties, relaxed and close to the mic, warm baritone. He sounds like he is standing in a grocery aisle talking normally, with natural inflection and a little breath. Not a radio host, not a robot, not breathy whispering.',
    text: 'Hey, do you want whole milk? I can add it, or you can tell me if you meant something else. Just say yes if that sounds right.',
  },
  {
    name: 'Butter Cow',
    description:
      'A playful cartoon cow whose only sound is a warm, round moo from the chest. Low, soft, a little silly, with a real animal mouth shape. It never speaks human words. Each moo has a natural rise and fall, like a friendly cow in a field, not a person reading the word moo.',
    text: 'Moo. Moo... moo. Moo. Moo... moo. Moo. Moo. Moo... moo. Moo. Moo. Moo... moo. Moo. Moo. Moo. Moo. Moo. Moo.',
  },
];

async function designOne(
  apiKey: string,
  voice: { name: string; description: string; text: string },
): Promise<Designed> {
  const previewRes = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description: voice.description,
      text: voice.text,
      model_id: 'eleven_multilingual_ttv_v2',
      guidance_scale: 3,
      should_enhance: true,
      quality: 0.85,
      loudness: 0.4,
    }),
  });
  if (!previewRes.ok) {
    const detail = await previewRes.text().catch(() => '');
    throw new Error(`${voice.name} design failed (${previewRes.status}): ${detail.slice(0, 300)}`);
  }
  const preview = (await previewRes.json()) as {
    previews?: { generated_voice_id?: string }[];
  };
  const generatedId = preview.previews?.[0]?.generated_voice_id;
  if (!generatedId) throw new Error(`${voice.name} returned no preview.`);

  const createRes = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_name: voice.name,
      voice_description: voice.description,
      generated_voice_id: generatedId,
    }),
  });
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '');
    throw new Error(`${voice.name} save failed (${createRes.status}): ${detail.slice(0, 300)}`);
  }
  const created = (await createRes.json()) as { voice_id?: string };
  if (!created.voice_id) throw new Error(`${voice.name} save returned no voice id.`);
  return { name: voice.name, voiceId: created.voice_id };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'POST required.' }, 405);
    requireServiceRole(req);
    const body = await req.json().catch(() => ({} as { confirm?: boolean; sound?: string }));
    if (!body.confirm) {
      return json({ error: 'Send { "confirm": true } to design new voices. This spends ElevenLabs credits.' }, 400);
    }
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!apiKey) return json({ error: 'ELEVENLABS_API_KEY is not configured.' }, 503);
    if (body.sound === 'cow') {
      const prompts = [
        {
          name: 'short',
          text: 'One realistic dairy cow moo, close microphone in a quiet barn, natural animal vocalization only, no human voice, no talking, no words, no music',
          duration_seconds: 1.6,
        },
        {
          name: 'long',
          text: 'Two realistic dairy cow moos with a short pause between them, close microphone in a quiet barn, natural animal vocalization only, no human voice, no talking, no words, no music',
          duration_seconds: 2.8,
        },
      ];
      const clips: { name: string; audioBase64: string }[] = [];
      for (const prompt of prompts) {
        const response = await fetch(
          'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_64',
          {
            method: 'POST',
            headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: prompt.text,
              duration_seconds: prompt.duration_seconds,
              prompt_influence: 0.9,
              model_id: 'eleven_text_to_sound_v2',
            }),
          },
        );
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Cow sound failed (${response.status}): ${detail.slice(0, 300)}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        clips.push({ name: prompt.name, audioBase64: btoa(binary) });
      }
      return json({ clips });
    }
    const voices: Designed[] = [];
    for (const voice of VOICES) {
      voices.push(await designOne(apiKey, voice));
    }
    return json({ voices });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : 'Voice design failed.' }, 500);
  }
});
