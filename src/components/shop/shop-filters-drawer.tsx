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
import { Spacing } from '@/constants/theme';
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
              borderLeftColor: theme.border,
              transform: [{ translateX }],
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Filters</ThemedText>
            <Pressable onPress={() => requestClose()}>
              <ThemedText type="linkPrimary">Close</ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <ThemedText type="smallBold">Sort</ThemedText>
            <View style={styles.chipRow}>
              {SORTS.map((option) => {
                const selected = sort === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setSort(option.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? theme.primary : theme.backgroundElement,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={selected ? { color: theme.primaryText } : undefined}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
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
            {grouped.avoid.slice(0, 8).map((trait) => (
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
            {grouped.requirePrefer.slice(0, 8).map((trait) => {
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
                    ).map((option) => {
                      const selected = (mode ?? null) === option.id;
                      return (
                        <Pressable
                          key={String(option.id)}
                          onPress={() => setRequirePrefer(trait.id, option.id)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? theme.primary : theme.backgroundElement,
                            },
                          ]}>
                          <ThemedText
                            type="small"
                            style={selected ? { color: theme.primaryText } : undefined}>
                            {option.label}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
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
              }}>
              <ThemedText type="linkPrimary">Clear all</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                setRules(onResetToPreferences());
              }}>
              <ThemedText type="linkPrimary">Reset prefs</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => requestClose(() => onApply({ rules, sort, onSaleOnly }))}
              style={[styles.applyBtn, { backgroundColor: theme.primary }]}>
              <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                Apply
              </ThemedText>
            </Pressable>
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
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
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
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
