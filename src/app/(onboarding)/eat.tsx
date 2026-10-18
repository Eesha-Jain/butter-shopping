import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { completeOnboardingWithDraft } from '@/auth/finish-onboarding';
import { useOnboardingDraft } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import {
  groupTraitsForFilterUi,
  listFoodTraits,
  type FoodTrait,
  type SessionFoodRule,
} from '@/backend';
import {
  Chip,
  OnboardingLabel,
  OnboardingShell,
} from '@/components/onboarding/onboarding-shell';
import { Fonts, Spacing } from '@/constants/theme';

export default function OnboardingEatScreen() {
  const { isGuest, finishOnboarding } = useSession();
  const draft = useOnboardingDraft();
  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [loading, setLoading] = useState(true);

  const finishPrefs = () => {
    void completeOnboardingWithDraft({
      isGuest,
      finishOnboarding,
      draft: draft.toPayload(),
    });
  };

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

  // Avoid / prefer chips come from food_traits in Supabase — no hard-coded list.
  const grouped = useMemo(() => groupTraitsForFilterUi(traits), [traits]);
  const avoidTraits = grouped.avoid;
  const preferTraits = grouped.requirePrefer;

  const selected = (traitId: string, mode: SessionFoodRule['mode']) =>
    draft.foodRules.some((rule) => rule.trait_id === traitId && rule.mode === mode);

  const toggle = (traitId: string, mode: SessionFoodRule['mode']) => {
    const exists = selected(traitId, mode);
    const without = draft.foodRules.filter((rule) => rule.trait_id !== traitId);
    draft.setFoodRules(exists ? without : [...without, { trait_id: traitId, mode }]);
  };

  return (
    <OnboardingShell
      step={3}
      title="Anything you avoid or prefer?"
      subtitle="Tap a few — you can change this later."
      onSkip={finishPrefs}
      onContinue={() => router.push('/(onboarding)/save' as Href)}>
      {loading ? (
        <ActivityIndicator color="#000000" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <OnboardingLabel>Avoid</OnboardingLabel>
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
          <OnboardingLabel>Prefer</OnboardingLabel>
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
            <Text style={styles.hint}>No filters loaded yet — skip and set them in Shop.</Text>
          ) : null}
        </ScrollView>
      )}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: '#333333',
    marginTop: Spacing.two,
  },
});
