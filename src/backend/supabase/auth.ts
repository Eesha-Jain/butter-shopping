import type { Session, Subscription } from '@supabase/supabase-js';

import { supabase } from './client';
import { unwrapVoid } from './query';

/**
 * Creates an Auth user. The database trigger then creates the profile, personal
 * group, owner membership, and default list. Pass displayName so the profile
 * has a name immediately. A project that requires email confirmation returns a
 * user with a null session until the address is confirmed.
 */
export async function signUp(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ userId: string | null; session: Session | null }> {
  const result = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { display_name: input.displayName ?? null } },
  });
  if (result.error) throw result.error;
  return { userId: result.data.user?.id ?? null, session: result.data.session };
}

/**
 * Signs in with email and password and stores the session on this device.
 */
export async function signIn(input: {
  email: string;
  password: string;
}): Promise<Session | null> {
  const result = await supabase.auth.signInWithPassword(input);
  if (result.error) throw result.error;
  return result.data.session;
}

/**
 * Clears the session stored by the Supabase client.
 */
export async function signOut(): Promise<void> {
  const result = await supabase.auth.signOut();
  if (result.error) throw result.error;
}

/**
 * Returns the current device session, or null when nobody is signed in.
 */
export async function getSession(): Promise<Session | null> {
  const result = await supabase.auth.getSession();
  if (result.error) throw result.error;
  return result.data.session;
}

/**
 * Subscribes to sign-in, sign-out, and token refresh. Call the returned
 * function when the screen unmounts.
 */
export function onAuthStateChange(
  listener: (session: Session | null) => void,
): () => void {
  const { data }: { data: { subscription: Subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => listener(session),
  );
  return () => data.subscription.unsubscribe();
}

/**
 * Sends a password-reset email. The link returns through the app's configured
 * Auth redirect URL; this function does not change the password itself.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  unwrapVoid(await supabase.auth.resetPasswordForEmail(email));
}
