import { supabase } from './client';

export type RipenessResult = {
  label: 'underripe' | 'ripe' | 'overripe' | 'unknown';
  confidence: number;
  note: string;
};

/**
 * Sends a produce photo to the ripeness Edge Function and returns its judgment.
 * The function does not store the photo. Pass imageBase64 without a data-URL
 * prefix. This does not create a database row.
 */
export async function analyzeRipeness(input: {
  imageBase64: string;
  contentType?: string;
  productHint?: string;
}): Promise<RipenessResult> {
  const result = await supabase.functions.invoke('analyze-ripeness', { body: input });
  if (result.error) throw result.error;
  return result.data as RipenessResult;
}
