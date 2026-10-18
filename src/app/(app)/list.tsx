import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Link } from 'expo-router';

import {
  buildStandardList,
  getDefaultGroceryList,
  listListItems,
  listVisibleRecipes,
  removeListItem,
  resolveShopZip,
  setListItemDone,
  showSuccessToast,
  suggestBestShopDate,
  type BestShopDay,
  type ListItem,
  type Recipe,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function GroceryListScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [bestShopDay, setBestShopDay] = useState<BestShopDay | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const { list } = await getDefaultGroceryList();
      setListId(list.id);
      const [rows, visibleRecipes, zip] = await Promise.all([
        listListItems(list.id),
        listVisibleRecipes(),
        resolveShopZip().catch(() => '98195'),
      ]);
      setItems(rows);
      setRecipes(visibleRecipes);
      try {
        setBestShopDay(await suggestBestShopDate({ postalCode: zip }));
      } catch {
        setBestShopDay(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your grocery list.');
      if (!refresh) {
        setItems(null);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onBuild = async () => {
    if (isBuilding) {
      return;
    }
    setIsBuilding(true);
    try {
      const added = await buildStandardList({ recipeIds: selectedRecipeIds });
      showSuccessToast(
        'Standard list updated',
        added === 0 ? 'Nothing new to add.' : `Added ${added} item${added === 1 ? '' : 's'}.`,
      );
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the list.');
    } finally {
      setIsBuilding(false);
    }
  };

  const toggleRecipe = (recipeId: string) => {
    setSelectedRecipeIds((current) =>
      current.includes(recipeId) ? current.filter((id) => id !== recipeId) : [...current, recipeId],
    );
  };

  if (isLoading && items == null) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="small" themeColor="textSecondary">
          Loading your list
        </ThemedText>
      </ThemedView>
    );
  }

  if (error && items == null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText>{error}</ThemedText>
        <Pressable onPress={() => void load()}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const openItems = (items ?? []).filter((item) => !item.done_at);
  const doneItems = (items ?? []).filter((item) => item.done_at);

  return (
    <FlatList
      data={[...openItems, ...doneItems]}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void load(true)}
          tintColor={theme.text}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? (
            <ThemedText type="small" themeColor="textSecondary">
              {error}
            </ThemedText>
          ) : null}
          <ThemedText type="subtitle">Grocery list</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Built from staples you eat and recipes you pick. Cart is for checkout later.
          </ThemedText>
          {bestShopDay ? (
            <ThemedText type="small" themeColor="textSecondary">
              Suggested shop day {bestShopDay.shopOn}: {bestShopDay.reasonLabel}
            </ThemedText>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={() => void onBuild()}
              disabled={isBuilding}
              style={[styles.button, { borderColor: theme.border, opacity: isBuilding ? 0.6 : 1 }]}>
              <ThemedText type="smallBold">{isBuilding ? 'Building…' : 'Build standard list'}</ThemedText>
            </Pressable>
            <Link href="/staples" asChild>
              <Pressable
                style={StyleSheet.flatten([styles.button, { borderColor: theme.border }])}>
                <ThemedText type="smallBold">Staples</ThemedText>
              </Pressable>
            </Link>
          </View>
          {recipes.length > 0 ? (
            <View style={styles.recipeBlock}>
              <ThemedText type="smallBold">Include recipes</ThemedText>
              {recipes.map((recipe) => {
                const selected = selectedRecipeIds.includes(recipe.id);
                return (
                  <Pressable
                    key={recipe.id}
                    onPress={() => toggleRecipe(recipe.id)}
                    style={[
                      styles.recipeChip,
                      {
                        backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                      },
                    ]}>
                    <ThemedText type="small">{recipe.title}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <ThemedView style={styles.empty}>
          <ThemedText type="subtitle">No items yet</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add staples you eat often, pick recipes, then build your standard list.
          </ThemedText>
        </ThemedView>
      }
      renderItem={({ item }) => (
        <ThemedView type="backgroundElement" style={styles.row}>
          <Pressable
            style={styles.rowMain}
            onPress={() => {
              void setListItemDone(item.id, !item.done_at).then(() => load(true));
            }}>
            <ThemedText style={item.done_at ? styles.doneText : undefined}>
              {labelForItem(item)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              qty {item.quantity}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              if (!listId) {
                return;
              }
              void removeListItem(item.id).then(() => load(true));
            }}>
            <ThemedText type="small" themeColor="textSecondary">
              Remove
            </ThemedText>
          </Pressable>
        </ThemedView>
      )}
    />
  );
}

function labelForItem(item: ListItem) {
  if (item.custom_name) {
    return item.custom_name;
  }
  if (item.category_id) {
    return 'Category item';
  }
  if (item.product_id) {
    return 'Product item';
  }
  return 'Item';
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  empty: {
    padding: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  button: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  recipeBlock: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  recipeChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  doneText: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
});
