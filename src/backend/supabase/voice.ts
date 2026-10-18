import { File, UploadType } from 'expo-file-system';

import { fail } from '../errors';
import { getAiVoice } from '../preferences';
import { supabase } from './client';

export type VoiceOrderSuggestion = {
  name: string;
  quantity: number;
  productId?: string;
  categoryId?: string;
  customName?: string;
  label: string;
};

export type VoiceOrderSplit = {
  phrase: string;
  one: VoiceOrderSuggestion | null;
  two: VoiceOrderSuggestion[];
};

export type VoiceOrderPhrases = {
  /** Confirmation after the shopper accepts a suggestion. Keep {quantity} and {label}. */
  added: string;
  /** Spoken after the shopper rejects a suggestion. */
  skipped: string;
  notProduct: string;
};

export type VoiceOrderResult = {
  transcript: string;
  /** Words from a one-time clarification. Empty when that clip had no speech. */
  heard?: string;
  reply: string;
  /** English wording, used when the shopper keeps English instead of the guessed language. */
  englishReply?: string;
  /** ISO 639-1 language of the shopper's request. */
  language?: string;
  /** Short follow-up lines in that same language. */
  phrases?: VoiceOrderPhrases;
  added: {
    name: string;
    quantity: number;
    matched: 'product' | 'category' | 'custom';
    productId?: string;
    listItemId?: string;
  }[];
  /** Same product is already an open list line. Confirm before changing its quantity. */
  already?: {
    name: string;
    productId: string;
    listItemId: string;
    existingQuantity: number;
    addQuantity: number;
  }[];
  /** Nearest catalog matches that need user confirmation before adding. */
  suggestions?: VoiceOrderSuggestion[];
  /** A phrase that could be one catalog item or two. The shopper picks before anything is added. */
  splits?: VoiceOrderSplit[];
  /** The assistant is unsure what this request meant. A one-time clarification can resolve it. */
  confused?: boolean;
  /** base64-encoded mp3 of `reply` spoken by ElevenLabs TTS, or null if TTS failed server-side. */
  replyAudioBase64: string | null;
};

async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) fail('Sign in before using the voice assistant.');
  return data.session!.access_token;
}

const CANT_HEAR = "I can't hear anything.";

function isSilenceFailure(message: string): boolean {
  return /can'?t hear|no recording|recording file is missing|transcription failed/i.test(message);
}

function silenceResult(): VoiceOrderResult {
  return {
    transcript: '',
    reply: CANT_HEAR,
    language: 'en',
    added: [],
    suggestions: [],
    replyAudioBase64: null,
  };
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
    const message = friendlyVoiceError((body as { error?: string } | null)?.error);
    if (isSilenceFailure(message)) return silenceResult();
    fail(message);
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
export type VoiceOrderExtras = {
  /** Saved address, or the phone's place when location is already allowed. */
  location?: string | null;
  /** Last three voice texts on this device, newest first. */
  recentTexts?: string[];
};

function voicePrivacyHeaders(extras?: VoiceOrderExtras): Record<string, string> {
  const headers: Record<string, string> = {};
  const location = extras?.location?.trim();
  if (location) headers['x-butter-location'] = encodeURIComponent(location.slice(0, 180));
  const recent = (extras?.recentTexts ?? [])
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (recent.length > 0) {
    headers['x-butter-recent'] = encodeURIComponent(JSON.stringify(recent).slice(0, 700));
  }
  return headers;
}

export async function voiceOrder(
  fileUri: string,
  context?: string,
  extras?: VoiceOrderExtras,
): Promise<VoiceOrderResult> {
  if (!fileUri) return silenceResult();
  const token = await getAuthToken();

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/voice-order`;
  const file = new File(fileUri);
  if (!file.exists) return silenceResult();

  let uploaded;
  try {
    uploaded = await file.upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: 'audio/m4a',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-butter-voice': getAiVoice(),
        ...voicePrivacyHeaders(extras),
        ...(context?.trim()
          ? { 'x-butter-context': encodeURIComponent(context.trim().slice(0, 500)) }
          : {}),
      },
    });
  } catch (err) {
    const message = friendlyVoiceError(err instanceof Error ? err.message : undefined);
    if (isSilenceFailure(message)) return silenceResult();
    fail(message);
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
/** ElevenLabs audio for a short line. Cow audio is mooing; the caller still shows `text`. */
export async function speakAssistant(text: string): Promise<string | null> {
  const line = text.trim().slice(0, 800);
  if (!line) return null;
  const token = await getAuthToken();
  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/voice-order`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ speakOnly: true, text: line, voice: getAiVoice() }),
  });
  const payload = (await response.json().catch(() => null)) as { replyAudioBase64?: string | null } | null;
  return payload?.replyAudioBase64 ?? null;
}

export async function voiceOrderFromText(
  transcript: string,
  clarify?: string,
  extras?: VoiceOrderExtras,
): Promise<VoiceOrderResult> {
  const trimmed = transcript.trim();
  const note = clarify?.trim().slice(0, 240) ?? '';
  if (!trimmed) fail('Type something to add first.');
  const token = await getAuthToken();

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/voice-order`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...voicePrivacyHeaders(extras),
    },
    body: JSON.stringify({
      transcript: trimmed,
      voice: getAiVoice(),
      ...(note ? { clarify: note } : {}),
    }),
  });

  return parseVoiceOrderResponse(response);
}
