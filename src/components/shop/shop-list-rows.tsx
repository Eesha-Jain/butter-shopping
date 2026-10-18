import { memo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { CategoryProductSection, Product, Promotion } from '@/backend';
import { CategoryIcon } from '@/components/shop/category-icons';
import { ShopProductCard, type ShopCardActions } from '@/components/shop/shop-product-card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Everything a card needs besides its product. Memoized by the screen so rows only
 * re-render when prices / list / favorites change — never just because the view switched.
 */
export type ShopCardState = {
  actions: ShopCardActions;
  promotions: Map<string, Promotion>;
  prices: Map<string, number>;
  cashbackActive: boolean;
  qtyMap: Map<string, { quantity: number }>;
  favoriteIds: Set<string>;
  peekSourceId: string | null;
};

export type StripItem = { product: Product; metaLabel?: string | null };

const STRIP_INITIAL_CARDS = 4;

function renderCard(
  product: Product,
  state: ShopCardState,
  index: number,
  compact: boolean,
  metaLabel?: string | null,
  butterColor?: string,
) {
  return (
    <ShopProductCard
      key={product.id}
      product={product}
      actions={state.actions}
      index={index}
      compact={compact}
      metaLabel={metaLabel}
      butterColor={butterColor}
      promotion={state.promotions.get(product.id) ?? null}
      priceCents={state.prices.get(product.id) ?? null}
      cashbackActive={state.cashbackActive}
      quantityOnList={state.qtyMap.get(product.id)?.quantity}
      isPeekSource={state.peekSourceId === product.id}
      favorited={state.favoriteIds.has(product.id)}
    />
  );
}

/** Horizontal, virtualized card strip (aisle previews, staples, trending). */
export const ShopProductStrip = memo(function ShopProductStrip({
  items,
  state,
  butterColor,
}: {
  items: StripItem[];
  state: ShopCardState;
  butterColor?: string;
}) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item) => item.product.id}
      renderItem={({ item, index }) =>
        renderCard(item.product, state, index, true, item.metaLabel, butterColor)
      }
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      initialNumToRender={STRIP_INITIAL_CARDS}
      maxToRenderPerBatch={STRIP_INITIAL_CARDS}
      windowSize={5}
      nestedScrollEnabled
    />
  );
});

export const ShopSectionRow = memo(function ShopSectionRow({
  section,
  previewCount,
  state,
  onOpenAisle,
}: {
  section: CategoryProductSection;
  previewCount: number;
  state: ShopCardState;
  onOpenAisle: (categoryId: string) => void;
}) {
  const theme = useTheme();
  const { category } = section;
  const items = section.products.slice(0, previewCount).map((product) => ({ product }));
  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Pressable
          onPress={() => onOpenAisle(category.id)}
          style={styles.titleTap}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Open ${category.name} aisle`}>
          <CategoryIcon name={category.name} size={20} color={theme.text} />
          <ThemedText type="smallBold" style={styles.title}>
            {category.name}
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => onOpenAisle(category.id)} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            See all
          </ThemedText>
        </Pressable>
      </View>
      <ShopProductStrip items={items} state={state} />
    </View>
  );
});

export const ShopGridRow = memo(function ShopGridRow({
  products,
  state,
}: {
  products: Product[];
  state: ShopCardState;
}) {
  return (
    <View style={styles.gridRow}>
      {products.map((product, index) => renderCard(product, state, index, false))}
      {products.length === 1 ? <View style={styles.flex} /> : null}
    </View>
  );
});

/** Gray placeholder row shown instantly while the real cards render. */
export const ShopSkeletonRow = memo(function ShopSkeletonRow() {
  const theme = useTheme();
  const block = { backgroundColor: theme.backgroundElement };
  return (
    <View style={styles.gridRow}>
      {[0, 1].map((key) => (
        <View key={key} style={styles.skeletonCard}>
          <View style={[styles.skeletonBlock, block]} />
          <View style={[styles.skeletonLine, block]} />
          <View style={[styles.skeletonLine, styles.skeletonLineShort, block]} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  strip: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  section: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  titleRow: {
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  title: {
    fontSize: Type.section,
    lineHeight: 28,
  },
  gridRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  skeletonCard: {
    flex: 1,
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    minHeight: 172,
    alignItems: 'center',
  },
  skeletonBlock: {
    width: 128,
    height: 128,
    borderRadius: Radius.card,
  },
  skeletonLine: {
    alignSelf: 'stretch',
    height: 12,
    borderRadius: 6,
  },
  skeletonLineShort: {
    width: '55%',
    alignSelf: 'flex-start',
  },
});
