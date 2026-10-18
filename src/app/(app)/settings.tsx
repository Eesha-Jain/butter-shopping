import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import {
  getGuestOnboardingDraft,
  getMyProfile,
  groupTraitsForFilterUi,
  listColleges,
  listFoodTraits,
  listMyDiscountEligibilities,
  listMyFoodRules,
  resolveCollegeId,
  saveGuestOnboardingDraft,
  setDiscountEligibility,
  setMyFoodRules,
  showErrorToast,
  updateMyProfile,
  type FoodTrait,
  type GuestOnboardingDraft,
  type SessionFoodRule,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ButterChip } from '@/components/ui/butter-chip';
import { BottomTabInset, Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const DISCOUNTS = [
  { code: 'student', label: 'Student' },
  { code: 'veteran', label: 'Veteran' },
  { code: 'veteran_family', label: 'Veteran family member' },
  { code: 'senior', label: 'Senior' },
  { code: 'snap', label: 'SNAP / EBT' },
] as const;

type CollegeOption = { id: string; name: string };

function writeGuest(patch: Partial<GuestOnboardingDraft>): void {
  saveGuestOnboardingDraft({ ...getGuestOnboardingDraft(), ...patch });
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { isGuest } = useSession();
  const [loading, setLoading] = useState(true);
  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [foodRules, setFoodRules] = useState<SessionFoodRule[]>([]);
  const [discountCodes, setDiscountCodes] = useState<string[]>([]);
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [collegeName, setCollegeName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [traitRows, collegeRows] = await Promise.all([
          listFoodTraits().catch(() => [] as FoodTrait[]),
          listColleges().catch(() => [] as CollegeOption[]),
        ]);
        if (!active) return;
        setTraits(traitRows);
        setColleges(collegeRows);

        if (isGuest) {
          const draft = getGuestOnboardingDraft();
          setFoodRules(draft.foodRules);
          setDiscountCodes(draft.discountCodes);
          setCollegeId(draft.collegeId);
          setCollegeName(draft.collegeName);
          setQuery(draft.collegeName ?? '');
          return;
        }

        const [rules, discounts, profile] = await Promise.all([
          listMyFoodRules(),
          listMyDiscountEligibilities(),
          getMyProfile(),
        ]);
        if (!active) return;
        setFoodRules(rules.map((rule) => ({ trait_id: rule.trait_id, mode: rule.mode })));
        setDiscountCodes(discounts.map((row) => row.group_code.toLowerCase()));
        const college = collegeRows.find((row) => row.id === profile.college_id) ?? null;
        setCollegeId(profile.college_id);
        setCollegeName(college?.name ?? null);
        setQuery(college?.name ?? '');
      } catch (err) {
        if (active) showErrorToast(err, 'Could not load settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isGuest]);

  const grouped = useMemo(() => groupTraitsForFilterUi(traits), [traits]);
  const studentSelected = discountCodes.includes('student');

  const filteredColleges = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return colleges.slice(0, 8);
    return colleges.filter((row) => row.name.toLowerCase().includes(term)).slice(0, 8);
  }, [colleges, query]);

  const selectedFood = (traitId: string, mode: SessionFoodRule['mode']) =>
    foodRules.some((rule) => rule.trait_id === traitId && rule.mode === mode);

  const toggleFood = (traitId: string, mode: SessionFoodRule['mode']) => {
    const exists = selectedFood(traitId, mode);
    const without = foodRules.filter((rule) => rule.trait_id !== traitId);
    const next = exists ? without : [...without, { trait_id: traitId, mode }];
    const previous = foodRules;
    setFoodRules(next);
    void (async () => {
      try {
        if (isGuest) {
          writeGuest({ foodRules: next });
          return;
        }
        await setMyFoodRules(next.map((rule) => ({ traitId: rule.trait_id, mode: rule.mode })));
      } catch (err) {
        setFoodRules(previous);
        showErrorToast(err, 'Could not save preferences.');
      }
    })();
  };

  const toggleDiscount = (code: string) => {
    const selected = discountCodes.includes(code);
    const nextCodes = selected
      ? discountCodes.filter((row) => row !== code)
      : [...discountCodes, code];
    const clearingStudent = code === 'student' && selected;
    const previous = {
      codes: discountCodes,
      collegeId,
      collegeName,
      query,
    };
    setDiscountCodes(nextCodes);
    if (clearingStudent) {
      setCollegeId(null);
      setCollegeName(null);
      setQuery('');
      setPickerOpen(false);
    }
    void (async () => {
      try {
        if (isGuest) {
          writeGuest({
            discountCodes: nextCodes,
            collegeId: clearingStudent ? null : collegeId,
            collegeName: clearingStudent ? null : collegeName,
          });
          return;
        }
        await setDiscountEligibility(code, !selected);
        if (clearingStudent) {
          await updateMyProfile({ college_id: null });
        }
      } catch (err) {
        setDiscountCodes(previous.codes);
        setCollegeId(previous.collegeId);
        setCollegeName(previous.collegeName);
        setQuery(previous.query);
        showErrorToast(err, 'Could not save demographics.');
      }
    })();
  };

  const pickCollege = (row: CollegeOption) => {
    const previous = { collegeId, collegeName, query };
    setCollegeId(row.id);
    setCollegeName(row.name);
    setQuery(row.name);
    setPickerOpen(false);
    Keyboard.dismiss();
    void (async () => {
      try {
        if (isGuest) {
          writeGuest({ collegeId: row.id, collegeName: row.name });
          return;
        }
        const resolved = await resolveCollegeId({ collegeId: row.id, collegeName: row.name });
        await updateMyProfile({ college_id: resolved });
        setCollegeId(resolved);
      } catch (err) {
        setCollegeId(previous.collegeId);
        setCollegeName(previous.collegeName);
        setQuery(previous.query);
        showErrorToast(err, 'Could not save your college.');
      }
    })();
  };

  const clearCollege = () => {
    const previous = { collegeId, collegeName, query };
    setCollegeId(null);
    setCollegeName(null);
    setQuery('');
    setPickerOpen(true);
    void (async () => {
      try {
        if (isGuest) {
          writeGuest({ collegeId: null, collegeName: null });
          return;
        }
        await updateMyProfile({ college_id: null });
      } catch (err) {
        setCollegeId(previous.collegeId);
        setCollegeName(previous.collegeName);
        setQuery(previous.query);
        showErrorToast(err, 'Could not clear your college.');
      }
    })();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <ThemedText type="linkPrimary">Back</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Settings</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Preferences and demographics stay with you
          {isGuest ? ' on this device' : ''}.
        </ThemedText>

        {loading ? (
          <ActivityIndicator color={theme.text} />
        ) : (
          <>
            <ThemedText type="smallBold">Preferences</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Avoid
            </ThemedText>
            <View style={styles.chips}>
              {grouped.avoid.map((trait) => (
                <ButterChip
                  key={trait.id}
                  label={trait.name}
                  selected={selectedFood(trait.id, 'avoid')}
                  onPress={() => toggleFood(trait.id, 'avoid')}
                />
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Prefer
            </ThemedText>
            <View style={styles.chips}>
              {grouped.requirePrefer.map((trait) => (
                <ButterChip
                  key={trait.id}
                  label={trait.name}
                  selected={selectedFood(trait.id, 'prefer')}
                  onPress={() => toggleFood(trait.id, 'prefer')}
                />
              ))}
            </View>
            {traits.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No food filters loaded yet.
              </ThemedText>
            ) : null}

            <ThemedText type="smallBold">Demographics</ThemedText>
            <View style={styles.chips}>
              {DISCOUNTS.map((row) => (
                <ButterChip
                  key={row.code}
                  label={row.label}
                  selected={discountCodes.includes(row.code)}
                  onPress={() => toggleDiscount(row.code)}
                />
              ))}
            </View>

            {studentSelected ? (
              <View style={styles.collegeBlock}>
                <ThemedText type="small" themeColor="textSecondary">
                  Your college
                </ThemedText>
                <View
                  style={[
                    styles.inputRow,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
                  ]}>
                  <TextInput
                    value={query}
                    onChangeText={(text) => {
                      setQuery(text);
                      setPickerOpen(true);
                    }}
                    onFocus={() => setPickerOpen(true)}
                    placeholder="Search your school"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text }]}
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
                        tintColor={theme.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>
                {pickerOpen ? (
                  <View
                    style={[
                      styles.dropdown,
                      { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
                    ]}>
                    {filteredColleges.map((row) => (
                      <Pressable
                        key={row.id}
                        onPress={() => pickCollege(row)}
                        style={[styles.dropdownRow, { borderBottomColor: theme.border }]}>
                        <ThemedText>{row.name}</ThemedText>
                      </Pressable>
                    ))}
                    {filteredColleges.length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.dropdownHint}>
                        {query.trim().length < 2
                          ? 'Type at least 2 letters'
                          : 'No schools match — try another name'}
                      </ThemedText>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
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
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two + 2,
    paddingRight: Spacing.two,
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
  clearBtn: {
    padding: Spacing.one,
  },
  dropdown: {
    borderWidth: 2,
    borderRadius: Radius.input,
    overflow: 'hidden',
  },
  dropdownRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownHint: {
    padding: Spacing.three,
  },
});
