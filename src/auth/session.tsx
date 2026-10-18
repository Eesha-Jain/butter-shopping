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
  hasCompletedOnboardingLocally,
  isGuest as readIsGuest,
  markIsGuest,
} from '@/backend/preferences';
import { mergeGuestCashbackIntoProfile, needsOnboarding } from '@/backend/cashback';
import { mergeGuestCartIntoDefaultList } from '@/backend/guest-cart';
import { mergeGuestFavoritesIntoAccount } from '@/backend/guest-favorites';
import { mergeGuestOnboardingIntoAccount } from '@/backend/guest-onboarding';
import {
  getSession,
  onAuthStateChange,
  signOut as backendSignOut,
} from '@/backend/supabase/auth';
import type { AuthMode } from '@/auth/auth-mode';

type SessionContextValue = {
  session: Session | null;
  isLoading: boolean;
  /** Browsing without a Supabase account. */
  isGuest: boolean;
  /** Signed in or continuing as guest. */
  canUseApp: boolean;
  /**
   * Whether onboarding (welcome → auth → prefs) should show.
   * null while resolving. First open shows onboarding even before sign-in.
   */
  needsOnboardingFlow: boolean | null;
  /** Preferred auth form mode when leaving guest / signed-out state. */
  preferredAuthMode: AuthMode | null;
  /** Mark onboarding done in-session (after Skip / Finish). */
  finishOnboarding: () => void;
  continueAsGuest: () => void;
  /** Leave guest mode and show auth (keeps local guest cart). */
  requestSignIn: (mode?: AuthMode) => void;
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
  const [preferredAuthMode, setPreferredAuthMode] = useState<AuthMode | null>(null);

  const refreshOnboardingGate = useCallback(async (guest: boolean, signedIn: boolean) => {
    // First launch: show onboarding before auth even with no session.
    if (!guest && !signedIn) {
      setNeedsOnboardingFlow(!hasCompletedOnboardingLocally());
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
        void mergeGuestOnboardingIntoAccount().catch(() => {
          // Same for onboarding food rules / discounts / transport.
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

  const requestSignIn = useCallback(
    (mode: AuthMode = 'logIn') => {
      clearGuest();
      setIsGuest(false);
      setPreferredAuthMode(mode);
      void refreshOnboardingGate(false, false);
    },
    [refreshOnboardingGate],
  );

  const finishOnboarding = useCallback(() => {
    setNeedsOnboardingFlow(false);
  }, []);

  const signOut = useCallback(async () => {
    if (!session) {
      clearGuest();
      setIsGuest(false);
      setPreferredAuthMode(null);
      void refreshOnboardingGate(false, false);
      return;
    }
    await backendSignOut();
  }, [refreshOnboardingGate, session]);

  const value: SessionContextValue = {
    session,
    isLoading,
    isGuest,
    canUseApp: !!session || isGuest,
    needsOnboardingFlow,
    preferredAuthMode,
    finishOnboarding,
    continueAsGuest,
    requestSignIn,
    signOut,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
