import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import type { SessionFoodRule } from '@/backend';

export type TransportMode = 'walk' | 'bike' | 'drive' | 'transit' | 'rideshare' | 'delivered';

export type OnboardingDraftPayload = {
  foodRules: SessionFoodRule[];
  discountCodes: string[];
  cashbackBps: number | null;
  collegeId: string | null;
  collegeName: string | null;
  transportModes: TransportMode[];
  maxStores: number | null;
};

type OnboardingDraft = OnboardingDraftPayload & {
  setFoodRules: (rules: SessionFoodRule[]) => void;
  toggleDiscount: (code: string) => void;
  setCashbackBps: (bps: number | null) => void;
  setCollege: (input: { id: string | null; name: string | null }) => void;
  toggleTransportMode: (mode: TransportMode) => void;
  setMaxStores: (n: number | null) => void;
  /** Snapshot for persist / skip-all. */
  toPayload: () => OnboardingDraftPayload;
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
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [collegeName, setCollegeName] = useState<string | null>(null);
  const [transportModes, setTransportModes] = useState<TransportMode[]>([]);
  const [maxStores, setMaxStores] = useState<number | null>(null);

  const toggleDiscount = useCallback((code: string) => {
    setDiscountCodes((prev) =>
      prev.includes(code) ? prev.filter((row) => row !== code) : [...prev, code],
    );
  }, []);

  const setCollege = useCallback((input: { id: string | null; name: string | null }) => {
    setCollegeId(input.id);
    setCollegeName(input.name);
  }, []);

  const toggleTransportMode = useCallback((mode: TransportMode) => {
    setTransportModes((prev) =>
      prev.includes(mode) ? prev.filter((row) => row !== mode) : [...prev, mode],
    );
  }, []);

  const toPayload = useCallback(
    (): OnboardingDraftPayload => ({
      foodRules,
      discountCodes,
      cashbackBps,
      collegeId,
      collegeName,
      transportModes,
      maxStores,
    }),
    [foodRules, discountCodes, cashbackBps, collegeId, collegeName, transportModes, maxStores],
  );

  const reset = useCallback(() => {
    setFoodRules([]);
    setDiscountCodes([]);
    setCashbackBps(null);
    setCollegeId(null);
    setCollegeName(null);
    setTransportModes([]);
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
      collegeId,
      collegeName,
      setCollege,
      transportModes,
      toggleTransportMode,
      maxStores,
      setMaxStores,
      toPayload,
      reset,
    }),
    [
      foodRules,
      discountCodes,
      toggleDiscount,
      cashbackBps,
      collegeId,
      collegeName,
      setCollege,
      transportModes,
      toggleTransportMode,
      maxStores,
      toPayload,
      reset,
    ],
  );

  return (
    <OnboardingDraftContext.Provider value={value}>{children}</OnboardingDraftContext.Provider>
  );
}
