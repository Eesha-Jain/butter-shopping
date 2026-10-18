import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  getDefaultGroceryList,
  listHabits,
  saveHabit,
  searchCategories,
  showErrorToast,
  showSuccessToast,
  type ItemHabit,
  type ProductCategory,
} from '@/backend';
import { CadencePickerModal } from '@/components/plan/cadence-picker-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterSearchField } from '@/components/ui/butter-search-field';
import { BottomTabInset, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function cadenceCopy(days: number): string {
  if (days === 7) return 'every week';
  if (days === 14) return 'every 2 weeks';
  if (days === 30) return 'every month';
  return `every ${days} days`;
}

export default function StaplesScreen() {
  const theme = useTheme();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [habits, setHabits] = useState<ItemHabit[] | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ProductCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingCategory, setPendingCategory] = useState<ProductCategory | null>(null);
  const [saving, setSaving] = useState(false);

  const loadHabits = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { group } = await getDefaultGroceryList();
      setGroupId(group.id);
      setHabits(await listHabits(group.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staples.');
      setHabits(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHabits();
  }, [loadHabits]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    void searchCategories(term)
      .then((rows) => {
        if (!cancelled) {
          setMatches(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMatches([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const saveWithCadence = async (intervalDays: number) => {
    if (!groupId || !pendingCategory || saving) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    try {
      await saveHabit({
        groupId,
        categoryId: pendingCategory.id,
        intervalDays,
        nextDueOn: today,
        autoAddEnabled: true,
      });
      showSuccessToast('Staple saved', `${pendingCategory.name} · ${cadenceCopy(intervalDays)}.`);
      setPendingCategory(null);
      setQuery('');
      setMatches([]);
      await loadHabits();
    } catch (err) {
      showErrorToast(err, 'Could not save that staple.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && habits == null) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.text} />
      </ThemedView>
    );
  }

  if (error && habits == null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText>{error}</ThemedText>
        <ButterButton label="Try again" variant="yellow" onPress={() => void loadHabits()} />
      </ThemedView>
    );
  }

  return (
    <>
      <FlatList
        data={habits ?? []}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              Foods you eat often
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Search a shopping category. Pick how often you buy it for your grocery days.
            </ThemedText>
            <ButterSearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search milk, eggs, rice…"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {matches.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => setPendingCategory(category)}
                style={[
                  styles.row,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.borderInk,
                  },
                ]}>
                <ThemedText type="smallBold">{category.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Set schedule
                </ThemedText>
              </Pressable>
            ))}
            <ThemedText type="smallBold">Saved staples</ThemedText>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            <ThemedText type="smallBold" style={styles.emptyTitle}>
              No staples yet
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              Search a food above to add something you buy often.
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.habitRow,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.borderInk,
              },
            ]}>
            <ThemedText type="smallBold">
              {item.category_id ? 'Category staple' : 'Product staple'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {cadenceCopy(item.interval_days)}
              {item.auto_add_enabled ? '' : ' · not auto-added'}
            </ThemedText>
          </View>
        )}
      />

      <CadencePickerModal
        visible={pendingCategory != null && !saving}
        productName={pendingCategory?.name ?? ''}
        allowSkip={false}
        onPickDays={(days) => void saveWithCadence(days)}
        onDismiss={() => setPendingCategory(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  title: {
    fontSize: Type.pageTitle,
    lineHeight: 34,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
    borderWidth: 2,
  },
  habitRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 2,
    gap: Spacing.half,
  },
  emptyBlock: {
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyTitle: {
    fontSize: Type.section,
  },
  empty: {
    textAlign: 'center',
  },
});
