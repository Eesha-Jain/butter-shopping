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
import {
  areAllTraitsAvoided,
  groupAvoidTraitsForFilterUi,
  groupTraitsForFilterUi,
  toggleAvoidGroup,
} from '@/backend';
import type { NearbyStore } from '@/backend/types';
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
  nearbyStores?: NearbyStore[];
  selectedStoreId?: string | null;
  onSelectStore?: (store: NearbyStore | null) => void;
  onClose: () => void;
  onApply: (next: {
    rules: SessionFoodRule[];
    sort: ShopSort;
    onSaleOnly: boolean;
  }) => void;
  onResetToPreferences: () => SessionFoodRule[];
};

const SORTS: { id: ShopSort; label: string }[] = [
  { id: 'default', label: 'Recommended' },
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'name', label: 'Name' },
];

export function ShopFiltersDrawer({
  visible,
  traits,
  draftRules,
  draftSort,
  draftOnSaleOnly,
  nearbyStores = [],
  selectedStoreId = null,
  onSelectStore,
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
  const avoidGroups = useMemo(
    () => groupAvoidTraitsForFilterUi(grouped.avoid),
    [grouped.avoid],
  );
  const ruleMap = useMemo(() => new Map(rules.map((rule) => [rule.trait_id, rule.mode])), [rules]);

  const toggleAvoid = (traitId: string) => {
    setRules((prev) => {
      const isAvoided = prev.some((rule) => rule.trait_id === traitId && rule.mode === 'avoid');
      const next = prev.filter((rule) => rule.trait_id !== traitId);
      if (!isAvoided) {
        next.push({ trait_id: traitId, mode: 'avoid' });
      }
      return next;
    });
  };

  const toggleAvoidGroupChips = (traitIds: string[]) => {
    setRules((prev) => toggleAvoidGroup(traitIds, prev));
  };

  /** Prefer and Must have are mutually exclusive per trait. */
  const togglePreferOrRequire = (traitId: string, mode: 'prefer' | 'require') => {
    setRules((prev) => {
      const current = prev.find((rule) => rule.trait_id === traitId)?.mode;
      const next = prev.filter((rule) => rule.trait_id !== traitId);
      if (current !== mode) {
        next.push({ trait_id: traitId, mode });
      }
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
            {nearbyStores.length > 0 && onSelectStore ? (
              <>
                <ThemedText type="smallBold">Store</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Limit the shelf to one nearby store.
                </ThemedText>
                <View style={styles.chipRow}>
                  <ButterChip
                    label="All stores"
                    selected={selectedStoreId == null}
                    onPress={() => onSelectStore(null)}
                  />
                  {nearbyStores.map((store) => (
                    <ButterChip
                      key={store.id}
                      label={store.name}
                      selected={selectedStoreId === store.id}
                      onPress={() => onSelectStore(store)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <ThemedText type="smallBold" style={nearbyStores.length > 0 ? styles.sectionGap : undefined}>
              Sort
            </ThemedText>
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

            <ThemedText type="smallBold" style={styles.sectionGap}>
              Avoid
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Hide products that contain these.
            </ThemedText>
            {avoidGroups.map((group) => {
              const groupIds = group.traits.map((trait) => trait.id);
              const groupSelected = areAllTraitsAvoided(groupIds, rules);
              return (
                <View key={group.id} style={styles.avoidGroup}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {group.label}
                  </ThemedText>
                  <View style={styles.chipRow}>
                    {group.groupChipLabel && group.traits.length > 1 ? (
                      <ButterChip
                        label={group.groupChipLabel}
                        selected={groupSelected}
                        onPress={() => toggleAvoidGroupChips(groupIds)}
                      />
                    ) : null}
                    {group.traits.map((trait) => (
                      <ButterChip
                        key={trait.id}
                        label={trait.name}
                        selected={ruleMap.get(trait.id) === 'avoid'}
                        onPress={() => toggleAvoid(trait.id)}
                      />
                    ))}
                  </View>
                </View>
              );
            })}

            <ThemedText type="smallBold" style={styles.sectionGap}>
              Prefer
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Rank matching products higher.
            </ThemedText>
            <View style={styles.chipRow}>
              {grouped.requirePrefer.map((trait) => (
                <ButterChip
                  key={`prefer-${trait.id}`}
                  label={trait.name}
                  selected={ruleMap.get(trait.id) === 'prefer'}
                  onPress={() => togglePreferOrRequire(trait.id, 'prefer')}
                />
              ))}
            </View>

            <ThemedText type="smallBold" style={styles.sectionGap}>
              Must have
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Only show products that match.
            </ThemedText>
            <View style={styles.chipRow}>
              {grouped.requirePrefer.map((trait) => (
                <ButterChip
                  key={`require-${trait.id}`}
                  label={trait.name}
                  selected={ruleMap.get(trait.id) === 'require'}
                  onPress={() => togglePreferOrRequire(trait.id, 'require')}
                />
              ))}
            </View>
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
  avoidGroup: {
    gap: Spacing.one,
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
