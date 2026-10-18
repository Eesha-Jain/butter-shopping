import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SnapBadge } from '@/components/shop/snap-badge';
import { ThemedText } from '@/components/themed-text';
import { ButterChip } from '@/components/ui/butter-chip';
import { ButterSearchField } from '@/components/ui/butter-search-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type StoreGroup, type StoreLike } from '@/utils/store-names';

const DEFAULT_VISIBLE = 5;

type Props<T extends StoreLike> = {
  groups: StoreGroup<T>[];
  selectedIds: string[];
  showSnapBadges?: boolean;
  onToggleGroup: (group: StoreGroup<T>) => void;
  onClear: () => void;
};

function groupSelection<T extends StoreLike>(group: StoreGroup<T>, selected: Set<string>) {
  const count = group.ids.filter((id) => selected.has(id)).length;
  return { all: count === group.ids.length, some: count > 0 };
}

/** Store multi-select: a few chips by default, a searchable checklist when expanded. */
export function StoreFilterSection<T extends StoreLike>({
  groups,
  selectedIds,
  showSnapBadges = false,
  onToggleGroup,
  onClear,
}: Props<T>) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const chipGroups = useMemo(() => {
    const top = groups.slice(0, DEFAULT_VISIBLE);
    const extraPicked = groups
      .slice(DEFAULT_VISIBLE)
      .filter((group) => groupSelection(group, selected).some);
    return [...top, ...extraPicked];
  }, [groups, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(q) ||
        group.stores.some((store) =>
          [store.city, store.region, store.postal_code, store.address_line1].some((part) =>
            part?.toLowerCase().includes(q),
          ),
        ),
    );
  }, [groups, query]);

  const hidden = groups.length - DEFAULT_VISIBLE;

  return (
    <>
      <ThemedText type="smallBold">Store</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Pick one or more nearby stores.
      </ThemedText>

      {expanded ? (
        <View style={[styles.list, { borderColor: theme.border }]}>
          <ButterSearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search stores or areas"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search stores"
          />
          <ScrollView style={styles.listScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                No stores match “{query.trim()}”.
              </ThemedText>
            ) : (
              filtered.map((group) => {
                const { all, some } = groupSelection(group, selected);
                const cities = [
                  ...new Set(group.stores.map((s) => s.city).filter((c): c is string => !!c)),
                ];
                const detail = [
                  `${group.stores.length} ${group.stores.length === 1 ? 'location' : 'locations'}`,
                  cities.slice(0, 2).join(', '),
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Pressable
                    key={group.key}
                    onPress={() => onToggleGroup(group)}
                    style={styles.row}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: all }}
                    accessibilityLabel={group.name}>
                    <SymbolView
                      name={{
                        ios: all
                          ? 'checkmark.square.fill'
                          : some
                            ? 'minus.square.fill'
                            : 'square',
                        android: all ? 'check_box' : some ? 'indeterminate_check_box' : 'check_box_outline_blank',
                        web: all ? 'check_box' : some ? 'indeterminate_check_box' : 'check_box_outline_blank',
                      }}
                      size={22}
                      tintColor={all || some ? theme.primary : theme.textSecondary}
                    />
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {group.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {detail}
                      </ThemedText>
                    </View>
                    {showSnapBadges && group.acceptsSnap ? <SnapBadge size="sm" /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <View style={styles.listFooter}>
            {selectedIds.length > 0 ? (
              <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button">
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Clear
                </ThemedText>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              onPress={() => {
                setExpanded(false);
                setQuery('');
              }}
              hitSlop={8}
              accessibilityRole="button">
              <ThemedText type="smallBold" style={{ color: theme.primaryDark }}>
                Show fewer
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.chipRow}>
          <ButterChip label="All stores" selected={selectedIds.length === 0} onPress={onClear} />
          {chipGroups.map((group) => (
            <ButterChip
              key={group.key}
              label={group.name}
              selected={groupSelection(group, selected).some}
              onPress={() => onToggleGroup(group)}
              icon={showSnapBadges && group.acceptsSnap ? <SnapBadge size="sm" /> : undefined}
            />
          ))}
          {hidden > 0 ? (
            <ButterChip label={`${hidden} more…`} onPress={() => setExpanded(true)} />
          ) : null}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  list: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  listScroll: {
    maxHeight: 280,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
  rowText: {
    flex: 1,
  },
  empty: {
    paddingVertical: Spacing.three,
    textAlign: 'center',
  },
  listFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
