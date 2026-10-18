import type { College } from '../types';
import { supabase } from './client';
import { unwrap } from './query';

/** Active colleges for onboarding dropdowns (name ascending). */
export async function listColleges(): Promise<Pick<College, 'id' | 'name'>[]> {
  return unwrap(
    await supabase.from('colleges').select('id, name').order('name').limit(5000),
  );
}

/**
 * Resolve a college by exact id, or find/create by name via ensure_college RPC.
 * Returns null when neither id nor a usable name is provided.
 */
export async function resolveCollegeId(input: {
  collegeId?: string | null;
  collegeName?: string | null;
}): Promise<string | null> {
  if (input.collegeId) return input.collegeId;
  const name = String(input.collegeName ?? '').trim();
  if (name.length < 2) return null;

  const { data, error } = await supabase.rpc('ensure_college', { p_name: name });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}
