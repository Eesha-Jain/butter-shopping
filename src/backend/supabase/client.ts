import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { getAuthStorage } from '../storage';
import type { Database } from '../types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY before using the Supabase client.',
  );
}

/**
 * The only Supabase client in the app. Domain modules import this; screens should
 * import functions from `@/backend` instead of calling this client directly.
 * The publishable key is public. Row level security, not a hidden key, protects data.
 */
export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: getAuthStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
