import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session, Subscription } from '@supabase/supabase-js';

import { fail } from '../errors';
import { markHasSignedIn } from '../preferences';
import { supabase } from './client';
import { unwrapVoid } from './query';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = makeRedirectUri({
  scheme: 'buttershopping',
  path: 'auth/callback',
});

function noteSignedIn(): void {
  markHasSignedIn();
}

function getAuthParams(url: string): { errorCode: string | null; params: Record<string, string> } {
  const hashPart = url.includes('#') ? url.split('#')[1] : '';
  const queryPart = url.includes('?') ? url.split('?')[1]?.split('#')[0] ?? '' : '';
  const combined = [queryPart, hashPart].filter(Boolean).join('&');
  const params: Record<string, string> = {};
  new URLSearchParams(combined).forEach((value, key) => {
    params[key] = value;
  });
  return {
    errorCode: params.error_description ?? params.error ?? null,
    params,
  };
}

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
  if (result.error) fail(result.error, 'Could not create an account.');
  if (result.data.user) noteSignedIn();
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
  if (result.error) fail(result.error, 'Could not sign in.');
  if (result.data.session) noteSignedIn();
  return result.data.session;
}

/**
 * Clears the session stored by the Supabase client.
 */
export async function signOut(): Promise<void> {
  const result = await supabase.auth.signOut();
  if (result.error) fail(result.error, 'Could not sign out.');
}

/**
 * Returns the current device session, or null when nobody is signed in.
 * A missing session is not an error and does not show a toast.
 */
export async function getSession(): Promise<Session | null> {
  const result = await supabase.auth.getSession();
  if (result.error) fail(result.error, 'Could not read the session.');
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
    (_event, session) => {
      if (session) noteSignedIn();
      listener(session);
    },
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

async function createSessionFromUrl(url: string): Promise<Session | null> {
  const { params, errorCode } = getAuthParams(url);
  if (errorCode) fail(errorCode, 'Could not complete Google sign-in.');

  const code = params.code;
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (result.error) fail(result.error, 'Could not complete Google sign-in.');
    if (result.data.session) noteSignedIn();
    return result.data.session;
  }

  const access_token = params.access_token;
  const refresh_token = params.refresh_token;
  if (!access_token) return null;

  const result = await supabase.auth.setSession({ access_token, refresh_token });
  if (result.error) fail(result.error, 'Could not complete Google sign-in.');
  if (result.data.session) noteSignedIn();
  return result.data.session;
}

/**
 * Opens Google OAuth (PKCE). On native, uses an in-app browser and deep link;
 * on web, follows the browser redirect.
 */
export async function signInWithGoogle(): Promise<Session | null> {
  const result = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });
  if (result.error) fail(result.error, 'Could not start Google sign-in.');
  if (!result.data.url) fail('Google sign-in did not return a URL.');

  if (Platform.OS === 'web') {
    // Browser navigates away; session completes after redirect.
    return null;
  }

  const authResult = await WebBrowser.openAuthSessionAsync(result.data.url, redirectTo);
  if (authResult.type !== 'success') return null;
  return createSessionFromUrl(authResult.url);
}
