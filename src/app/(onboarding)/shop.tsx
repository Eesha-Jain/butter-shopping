import { StyleSheet, View } from 'react-native';

import { completeOnboardingWithDraft } from '@/auth/finish-onboarding';
import { useOnboardingDraft, type TransportMode } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import {
  Chip,
  OnboardingLabel,
  OnboardingShell,
} from '@/components/onboarding/onboarding-shell';
import { Spacing } from '@/constants/theme';

const TRANSPORT: { id: TransportMode; label: string }[] = [
  { id: 'walk', label: 'Walk' },
  { id: 'bike', label: 'Bike' },
  { id: 'transit', label: 'Transit' },
  { id: 'drive', label: 'Drive' },
  { id: 'rideshare', label: 'Rideshare' },
  { id: 'delivered', label: 'Delivered' },
];

const STORE_CAPS = [
  { n: 1, label: '1 store' },
  { n: 2, label: 'Up to 2' },
  { n: 3, label: 'Up to 3' },
] as const;

export default function OnboardingShopScreen() {
  const { isGuest, finishOnboarding } = useSession();
  const draft = useOnboardingDraft();

  const finishPrefs = () => {
    void completeOnboardingWithDraft({
      isGuest,
      finishOnboarding,
      draft: draft.toPayload(),
    });
  };

  return (
    <OnboardingShell
      step={5}
      title="How do you usually get groceries?"
      subtitle="Pick every mode you use — so I can prefer stores that fit your trip."
      continueLabel="Finish"
      onSkip={finishPrefs}
      onContinue={finishPrefs}>
      <OnboardingLabel>I usually</OnboardingLabel>
      <View style={styles.chips}>
        {TRANSPORT.map((row) => (
          <Chip
            key={row.id}
            label={row.label}
            selected={draft.transportModes.includes(row.id)}
            onPress={() => draft.toggleTransportMode(row.id)}
          />
        ))}
      </View>

      <OnboardingLabel>Stores per trip</OnboardingLabel>
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
});
