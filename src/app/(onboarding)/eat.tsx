import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { useOnboardingDraft } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import { persistOnboardingDraft } from '@/auth/finish-onboarding';
import {
  groupTraitsForFilterUi,
  listFoodTraits,
  type FoodTrait,
  type SessionFoodRule,
} from '@/backend';
import { Chip, OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const AVOID_LIMIT = 8;
const PREFER_LIMIT = 6;

export default function OnboardingEatScreen() {
  const theme = useTheme();
  const { isGuest, finishOnboarding } = useSession();
  const draft = useOnboardingDraft();
  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listFoodTraits()
      .then((rows) => {
        if (active) setTraits(rows);
      })
      .catch(() => {
        if (active) setTraits([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const grouped = useMemo(() => groupTraitsForFilterUi(traits), [traits]);
  const avoidTraits = grouped.avoid.slice(0, AVOID_LIMIT);
  const preferTraits = grouped.requirePrefer.slice(0, PREFER_LIMIT);

  const selected = (traitId: string, mode: SessionFoodRule['mode']) =>
    draft.foodRules.some((rule) => rule.trait_id === traitId && rule.mode === mode);

  const toggle = (traitId: string, mode: SessionFoodRule['mode']) => {
    const exists = selected(traitId, mode);
    const without = draft.foodRules.filter((rule) => rule.trait_id !== traitId);
    draft.setFoodRules(exists ? without : [...without, { trait_id: traitId, mode }]);
  };

  const skipAll = async () => {
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
      // Enter app anyway.
    }
    finishOnboarding();
  };

  return (
    <OnboardingShell
      step={1}
      title="How do you eat?"
      subtitle="Tap anything to avoid or prefer. You can change this later in filters."
      onSkip={() => void skipAll()}
      onContinue={() => router.push('/(onboarding)/save')}>
      {loading ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ThemedText type="smallBold">Avoid</ThemedText>
          <View style={styles.chips}>
            {avoidTraits.map((trait) => (
              <Chip
                key={trait.id}
                label={trait.name}
                selected={selected(trait.id, 'avoid')}
                onPress={() => toggle(trait.id, 'avoid')}
              />
            ))}
          </View>
          <ThemedText type="smallBold" style={styles.section}>
            Prefer
          </ThemedText>
          <View style={styles.chips}>
            {preferTraits.map((trait) => (
              <Chip
                key={trait.id}
                label={trait.name}
                selected={selected(trait.id, 'prefer')}
                onPress={() => toggle(trait.id, 'prefer')}
              />
            ))}
          </View>
          {traits.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Food traits aren’t loaded yet — skip and set filters anytime in Shop.
            </ThemedText>
          ) : null}
        </ScrollView>
      )}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  section: {
    marginTop: Spacing.two,
  },
});
