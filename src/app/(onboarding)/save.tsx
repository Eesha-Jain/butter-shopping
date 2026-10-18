import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { completeOnboardingWithDraft } from '@/auth/finish-onboarding';
import { useOnboardingDraft } from '@/auth/onboarding-draft';
import { useSession } from '@/auth/session';
import { listColleges } from '@/backend';
import {
  Chip,
  OnboardingLabel,
  OnboardingShell,
} from '@/components/onboarding/onboarding-shell';
import { Fonts, Spacing } from '@/constants/theme';

const DISCOUNTS = [
  { code: 'student', label: 'Student' },
  { code: 'veteran', label: 'Veteran' },
  { code: 'veteran_family', label: 'Veteran family member' },
  { code: 'senior', label: 'Senior' },
  { code: 'snap', label: 'SNAP / EBT' },
] as const;

const CASHBACK = [
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
  { bps: 300, label: '3%+' },
] as const;

type CollegeOption = { id: string; name: string };

export default function OnboardingSaveScreen() {
  const { isGuest, finishOnboarding } = useSession();
  const draft = useOnboardingDraft();
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  const [query, setQuery] = useState(draft.collegeName ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  const studentSelected = draft.discountCodes.includes('student');

  const finishPrefs = () => {
    void completeOnboardingWithDraft({
      isGuest,
      finishOnboarding,
      draft: draft.toPayload(),
    });
  };

  useEffect(() => {
    let active = true;
    void listColleges()
      .then((rows) => {
        if (active) setColleges(rows);
      })
      .catch(() => {
        if (active) setColleges([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!studentSelected) {
      draft.setCollege({ id: null, name: null });
      setQuery('');
      setPickerOpen(false);
    }
    // Only react to discount toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft setter is stable
  }, [studentSelected]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return colleges.slice(0, 8);
    return colleges
      .filter((row) => row.name.toLowerCase().includes(term))
      .slice(0, 8);
  }, [colleges, query]);

  const pickCollege = (row: CollegeOption) => {
    draft.setCollege({ id: row.id, name: row.name });
    setQuery(row.name);
    setPickerOpen(false);
    Keyboard.dismiss();
  };

  const clearCollege = () => {
    draft.setCollege({ id: null, name: null });
    setQuery('');
    setPickerOpen(true);
  };

  return (
    <OnboardingShell
      step={4}
      title="Any savings I should use?"
      subtitle="Discounts + cash back. No card numbers — just a tap."
      onSkip={finishPrefs}
      onContinue={() => router.push('/(onboarding)/shop')}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
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

        {studentSelected ? (
          <View style={styles.collegeBlock}>
            <OnboardingLabel>Your college</OnboardingLabel>
            <View style={styles.inputRow}>
              <TextInput
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  setPickerOpen(true);
                  // Only a list pick counts — typing alone does not save a school.
                  draft.setCollege({ id: null, name: null });
                }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Search your school"
                placeholderTextColor="#666666"
                style={styles.input}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={clearCollege}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear college"
                  style={styles.clearBtn}>
                  <SymbolView
                    name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                    size={20}
                    tintColor="#666666"
                  />
                </Pressable>
              ) : null}
            </View>
            {pickerOpen ? (
              <View style={styles.dropdown}>
                {filtered.map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => pickCollege(row)}
                    style={styles.dropdownRow}>
                    <Text style={styles.dropdownText}>{row.name}</Text>
                  </Pressable>
                ))}
                {filtered.length === 0 ? (
                  <Text style={styles.dropdownHint}>
                    {query.trim().length < 2
                      ? 'Type at least 2 letters'
                      : 'No schools match — try another name'}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

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
      </ScrollView>
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
  collegeBlock: {
    gap: Spacing.two,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 14,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two + 2,
    paddingRight: Spacing.two,
    fontFamily: Fonts.sans,
    fontSize: 16,
    color: '#000000',
  },
  clearBtn: {
    padding: Spacing.one,
  },
  dropdown: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 14,
    overflow: 'hidden',
  },
  dropdownRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cccccc',
  },
  dropdownText: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: '#000000',
  },
  dropdownHint: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: '#666666',
    padding: Spacing.three,
  },
});
