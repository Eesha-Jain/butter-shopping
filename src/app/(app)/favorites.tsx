import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import {
  getProductsByIds,
  listMyFavoriteProductIds,
  productCardName,
  type Product,
} from '@/backend';
import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterBlock } from '@/components/ui/butter-block';
import { ButterButton } from '@/components/ui/butter-button';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function FavoritesScreen() {
  const theme = useTheme();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadFavorites = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const ids = await listMyFavoriteProductIds();
      setProducts(ids.length > 0 ? await getProductsByIds(ids) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load favorites.');
      setProducts(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  if (isLoading && products == null) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.text} />
      </ThemedView>
    );
  }

  if (error && products == null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText>{error}</ThemedText>
        <ButterButton label="Try again" variant="yellow" onPress={() => void loadFavorites()} />
      </ThemedView>
    );
  }

  return (
    <FlatList
      data={products ?? []}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.emptyBlock}>
          <ThemedText type="smallBold">No favorites yet</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Tap the heart on a product in Shop to save it here.
          </ThemedText>
        </View>
      }
      renderItem={({ item }) => {
        const title = productCardName(item);
        return (
          <View style={styles.row}>
            <ButterBlock size={72} color={theme.accentSoft}>
              <ProductPhoto imagePath={item.image_path} placeholderLetter={title} size={50} />
            </ButterBlock>
            <ThemedText type="smallBold" style={styles.name} numberOfLines={2}>
              {title}
            </ThemedText>
          </View>
        );
      }}
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
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  name: {
    flex: 1,
  },
  emptyBlock: {
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  empty: {
    textAlign: 'center',
  },
});
