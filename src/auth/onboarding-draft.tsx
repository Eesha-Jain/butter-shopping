import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import type { SessionFoodRule } from '@/backend';

export type TransportMode = 'walk' | 'bike' | 'drive' | 'transit' | 'rideshare';

type OnboardingDraft = {
  foodRules: SessionFoodRule[];
  setFoodRules: (rules: SessionFoodRule[]) => void;
  discountCodes: string[];
  toggleDiscount: (code: string) => void;
  cashbackBps: number | null;
  setCashbackBps: (bps: number | null) => void;
  transportMode: TransportMode | null;
  setTransportMode: (mode: TransportMode | null) => void;
  maxStores: number | null;
  setMaxStores: (n: number | null) => void;
  reset: () => void;
};

const OnboardingDraftContext = createContext<OnboardingDraft | null>(null);

export function useOnboardingDraft(): OnboardingDraft {
  const value = use(OnboardingDraftContext);
  if (!value) {
    throw new Error('useOnboardingDraft must be used within OnboardingDraftProvider');
  }
  return value;
}

export function OnboardingDraftProvider({ children }: PropsWithChildren) {
  const [foodRules, setFoodRules] = useState<SessionFoodRule[]>([]);
  const [discountCodes, setDiscountCodes] = useState<string[]>([]);
  const [cashbackBps, setCashbackBps] = useState<number | null>(null);
  const [transportMode, setTransportMode] = useState<TransportMode | null>(null);
  const [maxStores, setMaxStores] = useState<number | null>(null);

  const toggleDiscount = useCallback((code: string) => {
    setDiscountCodes((prev) =>
      prev.includes(code) ? prev.filter((row) => row !== code) : [...prev, code],
    );
  }, []);

  const reset = useCallback(() => {
    setFoodRules([]);
    setDiscountCodes([]);
    setCashbackBps(null);
    setTransportMode(null);
    setMaxStores(null);
  }, []);

  const value = useMemo(
    () => ({
      foodRules,
      setFoodRules,
      discountCodes,
      toggleDiscount,
      cashbackBps,
      setCashbackBps,
      transportMode,
      setTransportMode,
      maxStores,
      setMaxStores,
      reset,
    }),
    [
      foodRules,
      discountCodes,
      toggleDiscount,
      cashbackBps,
      transportMode,
      maxStores,
      reset,
    ],
  );

  return (
    <OnboardingDraftContext.Provider value={value}>{children}</OnboardingDraftContext.Provider>
  );
}
