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
  showSuccessToast,
  type ItemHabit,
  type ProductCategory,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterSearchField } from '@/components/ui/butter-search-field';
import { BottomTabInset, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function StaplesScreen() {
  const theme = useTheme();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [habits, setHabits] = useState<ItemHabit[] | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ProductCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const addStaple = async (category: ProductCategory) => {
    if (!groupId) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    await saveHabit({
      groupId,
      categoryId: category.id,
      intervalDays: 7,
      nextDueOn: today,
      autoAddEnabled: true,
    });
    showSuccessToast('Staple saved', `${category.name} every 7 days.`);
    setQuery('');
    setMatches([]);
    await loadHabits();
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
            Search a shopping category. Build list on the List tab uses these staples.
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
              onPress={() => void addStaple(category)}
              style={[
                styles.row,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.borderInk,
                },
              ]}>
              <ThemedText type="smallBold">{category.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add weekly
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
            every {item.interval_days} days
            {item.auto_add_enabled ? '' : ' · not auto-added'}
          </ThemedText>
        </View>
      )}
    />
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
