import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import {
  clearGuest,
  isGuest as readIsGuest,
  markIsGuest,
} from '@/backend/preferences';
import { mergeGuestCartIntoDefaultList } from '@/backend/guest-cart';
import {
  getSession,
  onAuthStateChange,
  signOut as backendSignOut,
} from '@/backend/supabase/auth';

type SessionContextValue = {
  session: Session | null;
  isLoading: boolean;
  /** Browsing without a Supabase account. */
  isGuest: boolean;
  /** Signed in or continuing as guest. */
  canUseApp: boolean;
  continueAsGuest: () => void;
  /** Leave guest mode and show auth (keeps local guest cart). */
  requestSignIn: () => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return value;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getSession()
      .then((next) => {
        if (!active) return;
        setSession(next);
        if (next) {
          clearGuest();
          setIsGuest(false);
        } else {
          setIsGuest(readIsGuest());
        }
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setIsGuest(readIsGuest());
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const unsubscribe = onAuthStateChange((next) => {
      setSession(next);
      setIsLoading(false);
      if (next) {
        clearGuest();
        setIsGuest(false);
        void mergeGuestCartIntoDefaultList().catch(() => {
          // Merge failures should not block sign-in; cart remains until retry.
        });
      } else {
        setIsGuest(readIsGuest());
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const continueAsGuest = useCallback(() => {
    markIsGuest();
    setIsGuest(true);
  }, []);

  const requestSignIn = useCallback(() => {
    clearGuest();
    setIsGuest(false);
  }, []);

  const signOut = useCallback(async () => {
    if (!session) {
      clearGuest();
      setIsGuest(false);
      return;
    }
    await backendSignOut();
  }, [session]);

  const value: SessionContextValue = {
    session,
    isLoading,
    isGuest,
    canUseApp: !!session || isGuest,
    continueAsGuest,
    requestSignIn,
    signOut,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
