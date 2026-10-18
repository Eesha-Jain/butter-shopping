import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

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
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
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
        <ActivityIndicator color={theme.secondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Loading your list
        </ThemedText>
      </ThemedView>
    );
  }

  if (error && items == null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="smallBold">{error}</ThemedText>
        <ButterButton label="Try again" variant="yellow" onPress={() => void load()} />
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
          <ThemedText type="smallBold" style={styles.pageTitle}>
            Grocery list
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Staples + recipes you pick. Cart is for checkout later.
          </ThemedText>
          {bestShopDay ? (
            <View
              style={[
                styles.hintCard,
                { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
              ]}>
              <ThemedText type="smallBold">Shop day tip</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {bestShopDay.shopOn}: {bestShopDay.reasonLabel}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.actions}>
            <ButterButton
              label={isBuilding ? 'Building…' : 'Build standard list'}
              variant="ink"
              disabled={isBuilding}
              onPress={() => void onBuild()}
              style={styles.actionBtn}
            />
            <ButterButton
              label="Staples"
              variant="ghost"
              onPress={() => router.push('/staples')}
              style={styles.actionBtn}
            />
          </View>
          {recipes.length > 0 ? (
            <View style={styles.recipeBlock}>
              <ThemedText type="smallBold">Include recipes</ThemedText>
              <View style={styles.recipeChips}>
                {recipes.map((recipe) => (
                  <ButterChip
                    key={recipe.id}
                    label={recipe.title}
                    selected={selectedRecipeIds.includes(recipe.id)}
                    onPress={() => toggleRecipe(recipe.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <ThemedView style={styles.empty}>
          <ThemedText type="smallBold" style={styles.pageTitle}>
            No items yet
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
            Add staples, pick recipes, then build your standard list.
          </ThemedText>
          <ButterButton label="Browse shop" variant="yellow" onPress={() => router.push('/')} />
        </ThemedView>
      }
      renderItem={({ item }) => (
        <View
          style={[
            styles.row,
            {
              backgroundColor: theme.background,
              borderColor: item.done_at ? theme.border : theme.borderInk,
            },
          ]}>
          <Pressable
            style={[
              styles.check,
              {
                backgroundColor: item.done_at ? theme.secondary : theme.background,
                borderColor: theme.borderInk,
              },
            ]}
            onPress={() => {
              void setListItemDone(item.id, !item.done_at).then(() => load(true));
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(item.done_at) }}>
            {item.done_at ? (
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                ✓
              </ThemedText>
            ) : null}
          </Pressable>
          <Pressable
            style={styles.rowMain}
            onPress={() => {
              void setListItemDone(item.id, !item.done_at).then(() => load(true));
            }}>
            <ThemedText type="smallBold" style={item.done_at ? styles.doneText : undefined}>
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
            }}
            hitSlop={8}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Remove
            </ThemedText>
          </Pressable>
        </View>
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
    gap: Spacing.three,
    alignItems: 'center',
  },
  emptyCopy: {
    textAlign: 'center',
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
  pageTitle: {
    fontSize: 28,
    lineHeight: 32,
  },
  hintCard: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  actionBtn: {
    flexGrow: 1,
    minWidth: 140,
    minHeight: 48,
    paddingVertical: Spacing.two + 2,
  },
  recipeBlock: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  recipeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  doneText: {
    textDecorationLine: 'line-through',
    opacity: 0.55,
  },
});
