import { fail } from '../errors';
import { supabase } from './client';

export type VoiceOrderResult = {
  transcript: string;
  reply: string;
  added: { name: string; quantity: number; matched: 'product' | 'category' | 'custom' }[];
  /** base64-encoded mp3 of `reply` spoken by ElevenLabs TTS, or null if TTS failed server-side. */
  replyAudioBase64: string | null;
};

async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) fail('Sign in before using the voice assistant.');
  return data.session!.access_token;
}

async function parseVoiceOrderResponse(response: Response): Promise<VoiceOrderResult> {
  const payload = (await response.json().catch(() => null)) as
    | VoiceOrderResult
    | { error?: string }
    | null;
  if (!response.ok || !payload || 'error' in payload) {
    fail((payload as { error?: string } | null)?.error ?? 'Voice order failed.');
  }
  return payload as VoiceOrderResult;
}

/**
 * Uploads a recorded push-to-talk clip to the voice-order Edge Function,
 * which transcribes it (ElevenLabs Scribe), asks Grok to extract grocery
 * items, adds them to the caller's default list, and sends an Expo push with
 * the result. Returns the same summary so the UI can show it immediately.
 *
 * Audio is recorded with expo-audio, which works in Expo Go. On-device
 * speech recognition (expo-speech-recognition) requires a custom EAS dev
 * client and was dropped for that reason.
 *
 * @param fileUri local file uri from expo-audio's recorder, e.g.
 *   recorder.uri after stop() (an .m4a/.caf file).
 */
export async function voiceOrder(fileUri: string): Promise<VoiceOrderResult> {
  if (!fileUri) fail('No recording to send.');
  const token = await getAuthToken();

  const form = new FormData();
  // React Native's fetch/FormData accepts this { uri, name, type } shape.
  form.append('audio', {
    uri: fileUri,
    name: 'clip.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/voice-order`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // Do NOT set Content-Type manually — RN needs to set the multipart
      // boundary itself based on the FormData body.
    },
    body: form,
  });

  return parseVoiceOrderResponse(response);
}

/**
 * Sends typed text straight to the same pipeline, skipping transcription
 * entirely. Useful as a fallback input and for testing the Grok-parsing /
 * Supabase-write / push steps without recording audio.
 */
export async function voiceOrderFromText(transcript: string): Promise<VoiceOrderResult> {
  const trimmed = transcript.trim();
  if (!trimmed) fail('Type something to add first.');
  const token = await getAuthToken();

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/voice-order`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transcript: trimmed }),
  });

  return parseVoiceOrderResponse(response);
}
