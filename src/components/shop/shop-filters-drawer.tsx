import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FoodTrait, SessionFoodRule, ShopSort } from '@/backend';
import { groupTraitsForFilterUi } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SLIDE_MS = 280;
const SLIDE_EASE = Easing.out(Easing.cubic);

type Props = {
  visible: boolean;
  traits: FoodTrait[];
  draftRules: SessionFoodRule[];
  draftSort: ShopSort;
  draftOnSaleOnly: boolean;
  onClose: () => void;
  onApply: (next: {
    rules: SessionFoodRule[];
    sort: ShopSort;
    onSaleOnly: boolean;
  }) => void;
  onResetToPreferences: () => SessionFoodRule[];
};

const SORTS: { id: ShopSort; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'name', label: 'Name' },
];

export function ShopFiltersDrawer({
  visible,
  traits,
  draftRules,
  draftSort,
  draftOnSaleOnly,
  onClose,
  onApply,
  onResetToPreferences,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(340, Math.round(width * 0.86));

  // Remount via parent `key` when opening so drafts re-seed without an effect.
  const [rules, setRules] = useState(draftRules);
  const [sort, setSort] = useState(draftSort);
  const [onSaleOnly, setOnSaleOnly] = useState(draftOnSaleOnly);
  const [closing, setClosing] = useState(false);
  const [translateX] = useState(() => new Animated.Value(panelWidth));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    translateX.setValue(panelWidth);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, panelWidth, translateX]);

  const requestClose = (afterClose?: () => void) => {
    if (closing) return;
    setClosing(true);
    const done = afterClose ?? onClose;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: panelWidth,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) done();
    });
  };

  const grouped = useMemo(() => groupTraitsForFilterUi(traits), [traits]);
  const ruleMap = useMemo(() => new Map(rules.map((rule) => [rule.trait_id, rule.mode])), [rules]);

  const setAvoid = (traitId: string, enabled: boolean) => {
    setRules((prev) => {
      const next = prev.filter((rule) => rule.trait_id !== traitId);
      if (enabled) next.push({ trait_id: traitId, mode: 'avoid' });
      return next;
    });
  };

  const setRequirePrefer = (traitId: string, mode: 'require' | 'prefer' | null) => {
    setRules((prev) => {
      const next = prev.filter((rule) => rule.trait_id !== traitId);
      if (mode) next.push({ trait_id: traitId, mode });
      return next;
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => requestClose()}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => requestClose()} />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              backgroundColor: theme.background,
              paddingTop: insets.top + Spacing.three,
              paddingBottom: insets.bottom + Spacing.three,
              borderLeftColor: theme.borderInk,
              transform: [{ translateX }],
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              Filters
            </ThemedText>
            <Pressable
              onPress={() => requestClose()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
                tintColor={theme.text}
              />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <ThemedText type="smallBold">Sort</ThemedText>
            <View style={styles.chipRow}>
              {SORTS.map((option) => (
                <ButterChip
                  key={option.id}
                  label={option.label}
                  selected={sort === option.id}
                  onPress={() => setSort(option.id)}
                />
              ))}
            </View>

            <View style={styles.switchRow}>
              <ThemedText type="smallBold">On sale only</ThemedText>
              <Switch
                value={onSaleOnly}
                onValueChange={setOnSaleOnly}
                trackColor={{ true: theme.primary, false: theme.border }}
              />
            </View>

            <ThemedText type="smallBold">Avoid</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Allergens and ingredients to hide
            </ThemedText>
            {grouped.avoid.map((trait) => (
              <View key={trait.id} style={styles.switchRow}>
                <ThemedText type="small">{trait.name}</ThemedText>
                <Switch
                  value={ruleMap.get(trait.id) === 'avoid'}
                  onValueChange={(enabled) => setAvoid(trait.id, enabled)}
                  trackColor={{ true: theme.primary, false: theme.border }}
                />
              </View>
            ))}

            <ThemedText type="smallBold" style={styles.sectionGap}>
              Must have / prefer
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Dietary needs. Prefer boosts matches; require hides the rest.
            </ThemedText>
            {grouped.requirePrefer.map((trait) => {
              const mode = ruleMap.get(trait.id);
              return (
                <View key={trait.id} style={styles.traitBlock}>
                  <ThemedText type="small">{trait.name}</ThemedText>
                  <View style={styles.chipRow}>
                    {(
                      [
                        { id: null, label: 'Off' },
                        { id: 'prefer' as const, label: 'Prefer' },
                        { id: 'require' as const, label: 'Require' },
                      ] as const
                    ).map((option) => (
                      <ButterChip
                        key={String(option.id)}
                        label={option.label}
                        selected={(mode ?? null) === option.id}
                        onPress={() => setRequirePrefer(trait.id, option.id)}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                setRules([]);
                setOnSaleOnly(false);
                setSort('default');
              }}
              hitSlop={8}>
              <ThemedText type="smallBold" style={{ textDecorationLine: 'underline' }}>
                Clear
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                setRules(onResetToPreferences());
              }}
              hitSlop={8}>
              <ThemedText type="smallBold" style={{ textDecorationLine: 'underline' }}>
                Reset prefs
              </ThemedText>
            </Pressable>
            <ButterButton
              label="Apply"
              variant="ink"
              onPress={() => requestClose(() => onApply({ rules, sort, onSaleOnly }))}
              style={styles.applyBtn}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SheetChrome.scrim,
  },
  panel: {
    height: '100%',
    borderLeftWidth: 2,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: Type.section,
  },
  scroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  traitBlock: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  sectionGap: {
    marginTop: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  applyBtn: {
    flexShrink: 0,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
});
