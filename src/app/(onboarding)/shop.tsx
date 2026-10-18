import { StyleSheet, View } from 'react-native';

import { persistOnboardingDraft } from '@/auth/finish-onboarding';
import { useOnboardingDraft, type TransportMode } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import { Chip, OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const TRANSPORT: { id: TransportMode; label: string }[] = [
  { id: 'walk', label: 'Walk' },
  { id: 'bike', label: 'Bike' },
  { id: 'transit', label: 'Transit' },
  { id: 'drive', label: 'Drive' },
  { id: 'rideshare', label: 'Rideshare' },
];

const STORE_CAPS = [
  { n: 1, label: '1 store' },
  { n: 2, label: 'Up to 2' },
  { n: 3, label: 'Up to 3' },
] as const;

export default function OnboardingShopScreen() {
  const { isGuest, finishOnboarding } = useSession();
  const draft = useOnboardingDraft();

  const persistAndFinish = async () => {
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
      // Still let them into the app; prefs can be set later.
    }
    finishOnboarding();
  };

  return (
    <OnboardingShell
      step={3}
      title="How do you shop?"
      subtitle="Helps Butter prefer nearby stores that fit how you get around."
      continueLabel="Start shopping"
      onSkip={() => void persistAndFinish()}
      onContinue={() => void persistAndFinish()}>
      <ThemedText type="smallBold">Getting groceries</ThemedText>
      <View style={styles.chips}>
        {TRANSPORT.map((row) => (
          <Chip
            key={row.id}
            label={row.label}
            selected={draft.transportMode === row.id}
            onPress={() =>
              draft.setTransportMode(draft.transportMode === row.id ? null : row.id)
            }
          />
        ))}
      </View>

      <ThemedText type="smallBold" style={styles.section}>
        Stores per trip
      </ThemedText>
      <View style={styles.chips}>
        {STORE_CAPS.map((row) => (
          <Chip
            key={row.n}
            label={row.label}
            selected={draft.maxStores === row.n}
            onPress={() => draft.setMaxStores(draft.maxStores === row.n ? null : row.n)}
          />
        ))}
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
  section: {
    marginTop: Spacing.three,
  },
});
