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
import { mergeGuestCashbackIntoProfile, needsOnboarding } from '@/backend/cashback';
import { mergeGuestCartIntoDefaultList } from '@/backend/guest-cart';
import { mergeGuestFavoritesIntoAccount } from '@/backend/guest-favorites';
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
  /**
   * Whether the 3-screen onboarding should show.
   * null while resolving; only meaningful when canUseApp.
   */
  needsOnboardingFlow: boolean | null;
  /** Mark onboarding done in-session (after Skip / Finish). */
  finishOnboarding: () => void;
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
  const [needsOnboardingFlow, setNeedsOnboardingFlow] = useState<boolean | null>(null);

  const refreshOnboardingGate = useCallback(async (guest: boolean, signedIn: boolean) => {
    if (!guest && !signedIn) {
      setNeedsOnboardingFlow(null);
      return;
    }
    try {
      const needed = await needsOnboarding(guest);
      setNeedsOnboardingFlow(needed);
    } catch {
      setNeedsOnboardingFlow(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    getSession()
      .then(async (next) => {
        if (!active) return;
        setSession(next);
        if (next) {
          clearGuest();
          setIsGuest(false);
          await refreshOnboardingGate(false, true);
        } else {
          const guest = readIsGuest();
          setIsGuest(guest);
          await refreshOnboardingGate(guest, false);
        }
      })
      .catch(async () => {
        if (!active) return;
        setSession(null);
        const guest = readIsGuest();
        setIsGuest(guest);
        await refreshOnboardingGate(guest, false);
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
        void mergeGuestFavoritesIntoAccount().catch(() => {
          // Same for favorites.
        });
        void mergeGuestCashbackIntoProfile().catch(() => {
          // Same for cashback prefs.
        });
        void refreshOnboardingGate(false, true);
      } else {
        const guest = readIsGuest();
        setIsGuest(guest);
        void refreshOnboardingGate(guest, false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshOnboardingGate]);

  const continueAsGuest = useCallback(() => {
    markIsGuest();
    setIsGuest(true);
    void refreshOnboardingGate(true, false);
  }, [refreshOnboardingGate]);

  const requestSignIn = useCallback(() => {
    clearGuest();
    setIsGuest(false);
    setNeedsOnboardingFlow(null);
  }, []);

  const finishOnboarding = useCallback(() => {
    setNeedsOnboardingFlow(false);
  }, []);

  const signOut = useCallback(async () => {
    if (!session) {
      clearGuest();
      setIsGuest(false);
      setNeedsOnboardingFlow(null);
      return;
    }
    await backendSignOut();
  }, [session]);

  const value: SessionContextValue = {
    session,
    isLoading,
    isGuest,
    canUseApp: !!session || isGuest,
    needsOnboardingFlow,
    finishOnboarding,
    continueAsGuest,
    requestSignIn,
    signOut,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
