import { File, UploadType } from 'expo-file-system';

import { fail } from '../errors';
import { supabase } from './client';

export type VoiceOrderSuggestion = {
  name: string;
  quantity: number;
  productId?: string;
  categoryId?: string;
  customName?: string;
  label: string;
};

export type VoiceOrderResult = {
  transcript: string;
  reply: string;
  added: { name: string; quantity: number; matched: 'product' | 'category' | 'custom' }[];
  /** Nearest catalog matches that need user confirmation before adding. */
  suggestions?: VoiceOrderSuggestion[];
  /** base64-encoded mp3 of `reply` spoken by ElevenLabs TTS, or null if TTS failed server-side. */
  replyAudioBase64: string | null;
};

async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) fail('Sign in before using the voice assistant.');
  return data.session!.access_token;
}

function friendlyVoiceError(raw: string | undefined): string {
  const message = (raw ?? '').trim();
  if (!message) return 'Could not add that to your list. Try again?';
  if (/FormDataPart/i.test(message)) {
    return 'Could not upload that recording. Try again, or type what to add instead.';
  }
  if (/grok request failed/i.test(message) || /\b402\b/.test(message)) {
    return 'The assistant is temporarily unavailable. Try again in a moment.';
  }
  return message;
}

function parseVoiceOrderPayload(payload: unknown, ok: boolean): VoiceOrderResult {
  const body = payload as VoiceOrderResult | { error?: string } | null;
  if (!ok || !body || 'error' in body) {
    fail(friendlyVoiceError((body as { error?: string } | null)?.error));
  }
  const result = body as VoiceOrderResult;
  return {
    ...result,
    suggestions: result.suggestions ?? [],
  };
}

async function parseVoiceOrderResponse(response: Response): Promise<VoiceOrderResult> {
  const payload = (await response.json().catch(() => null)) as
    | VoiceOrderResult
    | { error?: string }
    | null;
  return parseVoiceOrderPayload(payload, response.ok);
}

/**
 * Uploads a recorded push-to-talk clip to the voice-order Edge Function,
 * which transcribes it (ElevenLabs Scribe), asks Grok to extract grocery
 * items, adds them to the caller's default list, and sends an Expo push with
 * the result. Returns the same summary so the UI can show it immediately.
 *
 * Uses expo-file-system File.upload (multipart) instead of React Native's
 * `{ uri, name, type }` FormData descriptor — Expo SDK 56+ WinterCG fetch
 * rejects that shape with "Unsupported FormDataPart implementation" before
 * the request ever leaves the device (so Supabase never logs it).
 *
 * @param fileUri local file uri from expo-audio's recorder, e.g.
 *   recorder.uri after stop() (an .m4a/.caf file).
 */
export async function voiceOrder(fileUri: string): Promise<VoiceOrderResult> {
  if (!fileUri) fail('No recording to send.');
  const token = await getAuthToken();

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/voice-order`;
  const file = new File(fileUri);
  if (!file.exists) fail('Recording file is missing. Try again.');

  let uploaded;
  try {
    uploaded = await file.upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: 'audio/m4a',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    fail(friendlyVoiceError(err instanceof Error ? err.message : undefined));
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(uploaded.body) as VoiceOrderResult | { error?: string };
  } catch {
    payload = null;
  }
  return parseVoiceOrderPayload(payload, uploaded.status >= 200 && uploaded.status < 300);
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
