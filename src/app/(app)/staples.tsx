import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
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
import { BottomTabInset, Spacing } from '@/constants/theme';
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
        <Pressable onPress={() => void loadHabits()}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
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
          <ThemedText type="subtitle">Foods you eat often</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Search a shopping category. Build list on the List tab uses these staples.
          </ThemedText>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search milk, eggs, rice…"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />
          {matches.map((category) => (
            <Pressable
              key={category.id}
              onPress={() => void addStaple(category)}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText>{category.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add weekly
              </ThemedText>
            </Pressable>
          ))}
          <ThemedText type="smallBold">Saved staples</ThemedText>
        </View>
      }
      ListEmptyComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          No staples yet. Search a food above.
        </ThemedText>
      }
      renderItem={({ item }) => (
        <ThemedView type="backgroundElement" style={styles.habitRow}>
          <ThemedText>{item.category_id ? 'Category staple' : 'Product staple'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            every {item.interval_days} days
            {item.auto_add_enabled ? '' : ' · not auto-added'}
          </ThemedText>
        </ThemedView>
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  habitRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  empty: {
    padding: Spacing.three,
  },
});
