import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { persistOnboardingDraft } from '@/auth/finish-onboarding';
import { useOnboardingDraft } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import {
  Chip,
  OnboardingLabel,
  OnboardingShell,
} from '@/components/onboarding/onboarding-shell';
import { Spacing } from '@/constants/theme';

const DISCOUNTS = [
  { code: 'student', label: 'Student' },
  { code: 'veteran', label: 'Veteran' },
  { code: 'senior', label: 'Senior' },
] as const;

const CASHBACK = [
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
  { bps: 300, label: '3%+' },
] as const;

export default function OnboardingSaveScreen() {
  const { isGuest, finishOnboarding } = useSession();
  const draft = useOnboardingDraft();

  const skipRest = async () => {
    try {
      await persistOnboardingDraft({
        isGuest,
        foodRules: draft.foodRules,
        discountCodes: draft.discountCodes,
        cashbackBps: draft.cashbackBps,
        transportMode: draft.transportMode,
        maxStores: draft.maxStores,
      });
    } catch {
      // Still enter the app.
    }
    finishOnboarding();
  };

  return (
    <OnboardingShell
      step={2}
      title="Any savings I should use?"
      subtitle="Discounts + cash back. No card numbers — just a tap."
      onSkip={() => void skipRest()}
      onContinue={() => router.push('/(onboarding)/shop')}>
      <OnboardingLabel>Discounts</OnboardingLabel>
      <View style={styles.chips}>
        {DISCOUNTS.map((row) => (
          <Chip
            key={row.code}
            label={row.label}
            selected={draft.discountCodes.includes(row.code)}
            onPress={() => draft.toggleDiscount(row.code)}
          />
        ))}
      </View>

      <OnboardingLabel>Grocery cash back</OnboardingLabel>
      <View style={styles.chips}>
        {CASHBACK.map((row) => (
          <Chip
            key={row.bps}
            label={row.label}
            selected={draft.cashbackBps === row.bps}
            onPress={() =>
              draft.setCashbackBps(draft.cashbackBps === row.bps ? null : row.bps)
            }
          />
        ))}
        <Chip
          label="None"
          selected={draft.cashbackBps == null}
          onPress={() => draft.setCashbackBps(null)}
        />
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
