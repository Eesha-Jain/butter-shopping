import { useEffect, useMemo, useState } from 'react';

import { useSession } from '@/auth/session';
import { getGuestOnboardingDraft, listMyDiscountEligibilities } from '@/backend';

/** True when the user opted into SNAP / EBT during onboarding (guest or signed-in). */
export function useSnapOptedIn(): boolean {
  const { isGuest, canUseApp } = useSession();

  const guestOptedIn = useMemo(() => {
    if (!canUseApp || !isGuest) return false;
    return getGuestOnboardingDraft().discountCodes.some((code) => code.toLowerCase() === 'snap');
  }, [canUseApp, isGuest]);

  const [signedInOptedIn, setSignedInOptedIn] = useState(false);

  useEffect(() => {
    if (!canUseApp || isGuest) return;
    let active = true;
    void listMyDiscountEligibilities()
      .then((rows) => {
        if (!active) return;
        setSignedInOptedIn(rows.some((row) => row.group_code.toLowerCase() === 'snap'));
      })
      .catch(() => {
        if (active) setSignedInOptedIn(false);
      });
    return () => {
      active = false;
    };
  }, [canUseApp, isGuest]);

  if (!canUseApp) return false;
  if (isGuest) return guestOptedIn;
  return signedInOptedIn;
}
