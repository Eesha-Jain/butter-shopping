import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGuestCart } from '@/auth/guest-cart-context';
import { useSession } from '@/auth/session';
import {
  addListItem,
  applyFoodFilters,
  ensureCatalogForTerm,
  formatPromotionBadge,
  getActiveListProductQtyMap,
  getCheapestPriceCentsByProductIds,
  getMyDefaultList,
  getMyProfile,
  getProductPromotionMap,
  getProductTraitsForIds,
  getProductsByIds,
  indexTraitsByProduct,
  listActiveProducts,
  listCampusPopularProducts,
  listCategories,
  listFoodTraits,
  listMyFoodRules,
  listMyListTargets,
  listMyLocations,
  listMyStapleProductIds,
  listTrending,
  messageFromUnknown,
  removeListItem,
  resolveShopZip,
  rulesFromUserFoodRules,
  searchProducts,
  showErrorToast,
  showSuccessToast,
  updateListItem,
  type ActiveListTarget,
  type FoodTrait,
  type Product,
  type ProductCategory,
  type Promotion,
  type SessionFoodRule,
  type ShopSort,
  type UserLocation,
} from '@/backend';
import { ProductCard } from '@/components/shop/product-card';
import { ProductDetailSheet } from '@/components/shop/product-detail-sheet';
import { ShopFiltersDrawer } from '@/components/shop/shop-filters-drawer';
import { ShopProfileDrawer } from '@/components/shop/shop-profile-drawer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const VISIBLE_CATEGORIES = 4;
const SEARCH_DEBOUNCE_MS = 300;

export default function ShopScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isGuest, requestSignIn, signOut } = useSession();
  const guestCart = useGuestCart();
  const productSheetRef = useRef<BottomSheetModal>(null);
  const seededPrefsRef = useRef(false);

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [listTargets, setListTargets] = useState<ActiveListTarget[]>([]);
  const [activeTarget, setActiveTarget] = useState<ActiveListTarget | null>(null);
  const [qtyMap, setQtyMap] = useState<Map<string, { listItemId: string; quantity: number }>>(
    new Map(),
  );

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [moreCategoriesOpen, setMoreCategoriesOpen] = useState(false);

  const [staples, setStaples] = useState<Product[]>([]);
  const [staplesArePersonal, setStaplesArePersonal] = useState(false);
  const [trending, setTrending] = useState<{ product: Product; sponsored: boolean }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Map<string, Promotion>>(new Map());
  const [checkingStores, setCheckingStores] = useState(false);

  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [preferenceRules, setPreferenceRules] = useState<SessionFoodRule[]>([]);
  const [sessionRules, setSessionRules] = useState<SessionFoodRule[]>([]);
  const [sort, setSort] = useState<ShopSort>('default');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shellReady, setShellReady] = useState(false);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const guestQtyMap = useMemo(() => {
    const map = new Map<string, { listItemId: string; quantity: number }>();
    for (const item of guestCart.items) {
      if (!item.productId) continue;
      map.set(item.productId, { listItemId: item.id, quantity: item.quantity });
    }
    return map;
  }, [guestCart.items]);

  const effectiveQtyMap = isGuest ? guestQtyMap : qtyMap;

  const refreshQtyMap = useCallback(async (listId: string) => {
    setQtyMap(await getActiveListProductQtyMap(listId));
  }, []);

  const loadShell = useCallback(
    async (refresh = false) => {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const foodTraits = await listFoodTraits();
        setTraits(foodTraits);

        if (isGuest) {
          setLocation(null);
          setDisplayName(null);
          setAvatarPath(null);
          setListTargets([]);
          setActiveTarget(null);
          setPreferenceRules([]);
          if (!seededPrefsRef.current || refresh) {
            setSessionRules([]);
            seededPrefsRef.current = true;
          }
        } else {
          const [locations, targets, foodRules, defaultTarget, profile] = await Promise.all([
            listMyLocations(),
            listMyListTargets(),
            listMyFoodRules(),
            getMyDefaultList(),
            getMyProfile(),
          ]);
          setLocation(locations.find((row) => row.is_default) ?? locations[0] ?? null);
          setDisplayName(profile.display_name);
          setAvatarPath(profile.avatar_path);
          setListTargets(targets);
          const prefs = rulesFromUserFoodRules(foodRules);
          setPreferenceRules(prefs);
          if (!seededPrefsRef.current || refresh) {
            setSessionRules(prefs);
            seededPrefsRef.current = true;
          }
          setActiveTarget((current) => {
            if (current && targets.some((row) => row.list.id === current.list.id)) {
              return current;
            }
            return defaultTarget;
          });
          await refreshQtyMap(defaultTarget.list.id);
        }
        setShellReady(true);
      } catch (err) {
        setError(messageFromUnknown(err, 'Could not load the shop.'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isGuest, refreshQtyMap],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadShell();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadShell]);

  useEffect(() => {
    if (!shellReady) return;

    let cancelled = false;
    void (async () => {
      try {
        const collegeId = isGuest ? null : (await getMyProfile()).college_id;
        const groupId = activeTarget?.group.id;

        const [promoMap, cats, stapleProductIds, trendingRows, popularCampus] = await Promise.all([
          getProductPromotionMap(),
          listCategories(),
          groupId ? listMyStapleProductIds(groupId) : Promise.resolve([] as string[]),
          listTrending(collegeId),
          listCampusPopularProducts({ limit: 12 }),
        ]);
        if (cancelled) return;

        setPromotions(promoMap);
        setCategories(cats);

        if (stapleProductIds.length > 0) {
          setStaples(await getProductsByIds(stapleProductIds));
          setStaplesArePersonal(true);
        } else {
          setStaples(popularCampus);
          setStaplesArePersonal(false);
        }

        const trendingProductIds = trendingRows
          .filter((row) => row.kind === 'product' && row.product_id)
          .map((row) => row.product_id as string);
        const trendingProducts = await getProductsByIds(trendingProductIds);
        if (cancelled) return;
        const byId = new Map(trendingProducts.map((row) => [row.id, row]));
        const organicTrending = trendingRows
          .filter((row) => row.kind === 'product' && row.product_id && byId.has(row.product_id))
          .map((row) => ({
            product: byId.get(row.product_id as string)!,
            sponsored: row.source === 'sponsored',
          }));
        if (organicTrending.length > 0) {
          setTrending(organicTrending);
        } else if (stapleProductIds.length > 0 && popularCampus.length > 0) {
          // Personal staples exist; use campus popular as the discovery band.
          setTrending(popularCampus.map((product) => ({ product, sponsored: false })));
        } else {
          // Avoid duplicating the same Popular on campus carousel under staples.
          setTrending([]);
        }

        let rawProducts = debouncedSearch
          ? await searchProducts(debouncedSearch)
          : await listActiveProducts({ categoryId: selectedCategoryId, limit: 60 });
        if (cancelled) return;

        // Demand-driven ingest: only when the user searched and the catalog is thin.
        if (debouncedSearch.length >= 2 && rawProducts.length < 3) {
          setCheckingStores(true);
          try {
            const zip = await resolveShopZip();
            if (cancelled) return;
            rawProducts = await ensureCatalogForTerm(debouncedSearch, zip);
          } catch (err) {
            if (!cancelled) {
              showErrorToast(err, 'Could not check nearby stores.');
            }
          } finally {
            if (!cancelled) setCheckingStores(false);
          }
        } else if (!cancelled) {
          setCheckingStores(false);
        }
        if (cancelled) return;

        const [traitsForProducts, priceMap] = await Promise.all([
          getProductTraitsForIds(rawProducts.map((row) => row.id)),
          getCheapestPriceCentsByProductIds(rawProducts.map((row) => row.id)),
        ]);
        if (cancelled) return;

        setProducts(
          applyFoodFilters(rawProducts, sessionRules, indexTraitsByProduct(traitsForProducts), {
            sort,
            stapleIds: new Set(stapleProductIds),
            onSaleOnly,
            promotionProductIds: new Set(promoMap.keys()),
            priceCentsByProduct: priceMap,
          }),
        );
        if (activeTarget) {
          await refreshQtyMap(activeTarget.list.id);
        }
      } catch (err) {
        if (!cancelled) {
          showErrorToast(err, 'Could not update products.');
          setCheckingStores(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTarget,
    debouncedSearch,
    isGuest,
    onSaleOnly,
    refreshQtyMap,
    selectedCategoryId,
    sessionRules,
    shellReady,
    sort,
  ]);

  const openProduct = (product: Product) => {
    setSelectedProduct(product);
    productSheetRef.current?.present();
  };

  const hapticSuccess = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Unsupported platforms no-op.
    }
  };

  const handleAdd = async (product: Product) => {
    try {
      if (isGuest) {
        guestCart.addItem({ productId: product.id, quantity: 1 });
      } else {
        const target = activeTarget;
        if (!target) {
          showErrorToast(new Error('No list selected.'));
          return;
        }
        await addListItem({ listId: target.list.id, productId: product.id, quantity: 1 });
        await refreshQtyMap(target.list.id);
      }
      await hapticSuccess();
      showSuccessToast('Added', product.name);
    } catch (err) {
      showErrorToast(err, 'Could not add that item.');
    }
  };

  const handleIncrement = async (product: Product) => {
    const entry = effectiveQtyMap.get(product.id);
    if (!entry) {
      await handleAdd(product);
      return;
    }
    try {
      if (isGuest) {
        guestCart.setQuantity(entry.listItemId, entry.quantity + 1);
      } else {
        const target = activeTarget;
        if (!target) return;
        await updateListItem(entry.listItemId, { quantity: entry.quantity + 1 });
        await refreshQtyMap(target.list.id);
      }
      await hapticSuccess();
    } catch (err) {
      showErrorToast(err, 'Could not update quantity.');
    }
  };

  const handleDecrement = async (product: Product) => {
    const entry = effectiveQtyMap.get(product.id);
    if (!entry) return;
    try {
      if (isGuest) {
        guestCart.setQuantity(entry.listItemId, entry.quantity - 1);
      } else {
        const target = activeTarget;
        if (!target) return;
        if (entry.quantity <= 1) {
          await removeListItem(entry.listItemId);
        } else {
          await updateListItem(entry.listItemId, { quantity: entry.quantity - 1 });
        }
        await refreshQtyMap(target.list.id);
      }
    } catch (err) {
      showErrorToast(err, 'Could not update quantity.');
    }
  };

  const openFilters = useCallback(() => {
    setProfileOpen(false);
    setFiltersOpen(true);
  }, []);

  const openProfile = useCallback(() => {
    setFiltersOpen(false);
    setProfileOpen(true);
  }, []);

  // Swipe left opens the profile panel (also accepts a rightward pull from the left edge).
  const leftEdgeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-40, 40])
        .onEnd((event) => {
          if (event.translationX < -48 || event.translationX > 48) {
            runOnJS(openProfile)();
          }
        }),
    [openProfile],
  );

  // Swipe from the right edge opens filters.
  const rightEdgeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-40, 40])
        .onEnd((event) => {
          if (event.translationX < -48) {
            runOnJS(openFilters)();
          }
        }),
    [openFilters],
  );

  const visibleCategories = categories.slice(0, VISIBLE_CATEGORIES);
  const extraCategories = categories.slice(VISIBLE_CATEGORIES);

  const gridData = useMemo(() => {
    const rows: Product[][] = [];
    for (let i = 0; i < products.length; i += 2) {
      rows.push(products.slice(i, i + 2));
    }
    return rows;
  }, [products]);

  if (isLoading && !shellReady) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="small" themeColor="textSecondary">
          Loading shop
        </ThemedText>
      </ThemedView>
    );
  }

  if (error && !shellReady) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText>{error}</ThemedText>
        <Pressable onPress={() => void loadShell()}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <GestureDetector gesture={leftEdgeSwipe}>
        <View style={[styles.edgeHitLeft, { top: insets.top }]} />
      </GestureDetector>
      <GestureDetector gesture={rightEdgeSwipe}>
        <View style={[styles.edgeHitRight, { top: insets.top }]} />
      </GestureDetector>
      <FlatList
          data={gridData}
          keyExtractor={(_, index) => `row-${index}`}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: BottomTabInset + Spacing.four },
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void loadShell(true)}
              tintColor={theme.text}
            />
          }
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.locationRow}>
                <Pressable
                  onPress={openProfile}
                  hitSlop={8}
                  style={[styles.iconBtn, { backgroundColor: theme.backgroundElement }]}
                  accessibilityRole="button"
                  accessibilityLabel="Open profile">
                  <SymbolView
                    name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
                <ThemedText type="smallBold">Near</ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={2}
                  style={styles.flex}>
                  {isGuest ? 'Sign in to save a default location' : formatLocation(location)}
                </ThemedText>
              </View>

              <View style={styles.searchRow}>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search products"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.searchInput,
                    {
                      backgroundColor: theme.backgroundElement,
                      color: theme.text,
                      borderColor: theme.border,
                    },
                  ]}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                />
                <Pressable
                  onPress={openFilters}
                  style={[styles.iconBtn, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Open filters">
                  <SymbolView
                    name={{
                      ios: 'line.3.horizontal.decrease',
                      android: 'filter_list',
                      web: 'filter_list',
                    }}
                    size={22}
                    tintColor={theme.primaryText}
                  />
                </Pressable>
              </View>

              {!isGuest && listTargets.length > 1 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}>
                  {listTargets.map((target) => {
                    const selected = activeTarget?.list.id === target.list.id;
                    return (
                      <Pressable
                        key={target.list.id}
                        onPress={() => {
                          setActiveTarget(target);
                          void refreshQtyMap(target.list.id);
                        }}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected ? theme.primary : theme.backgroundElement,
                          },
                        ]}>
                        <ThemedText
                          type="small"
                          style={selected ? { color: theme.primaryText } : undefined}
                          numberOfLines={1}>
                          {target.group.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  {isGuest
                    ? 'Guest cart (sign in to sync lists)'
                    : `Shopping for ${activeTarget?.group.name ?? 'My List'}`}
                </ThemedText>
              )}

              {trending.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="subtitle">
                    {trending.every((row) => !row.sponsored) && staplesArePersonal
                      ? 'Popular on campus'
                      : 'Trending'}
                  </ThemedText>
                  <FlatList
                    horizontal
                    data={trending}
                    keyExtractor={(item) => item.product.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.carousel}
                    renderItem={({ item }) => (
                      <ProductCard
                        product={item.product}
                        compact
                        sponsored={item.sponsored}
                        saleBadge={
                          promotions.has(item.product.id)
                            ? formatPromotionBadge(promotions.get(item.product.id)!)
                            : null
                        }
                        quantityOnList={effectiveQtyMap.get(item.product.id)?.quantity}
                        onPress={() => openProduct(item.product)}
                        onAdd={() => void handleAdd(item.product)}
                        onIncrement={() => void handleIncrement(item.product)}
                        onDecrement={() => void handleDecrement(item.product)}
                      />
                    )}
                  />
                </View>
              ) : null}

              {staples.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="subtitle">
                    {staplesArePersonal ? 'Your staples' : 'Popular on campus'}
                  </ThemedText>
                  <FlatList
                    horizontal
                    data={staples}
                    keyExtractor={(item) => item.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.carousel}
                    renderItem={({ item }) => (
                      <ProductCard
                        product={item}
                        compact
                        saleBadge={
                          promotions.has(item.id)
                            ? formatPromotionBadge(promotions.get(item.id)!)
                            : null
                        }
                        quantityOnList={effectiveQtyMap.get(item.id)?.quantity}
                        onPress={() => openProduct(item)}
                        onAdd={() => void handleAdd(item)}
                        onIncrement={() => void handleIncrement(item)}
                        onDecrement={() => void handleDecrement(item)}
                      />
                    )}
                  />
                </View>
              ) : null}

              <View style={styles.section}>
                <ThemedText type="subtitle">Category</ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}>
                  <Pressable
                    onPress={() => setSelectedCategoryId(null)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          selectedCategoryId == null ? theme.primary : theme.backgroundElement,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={selectedCategoryId == null ? { color: theme.primaryText } : undefined}>
                      All
                    </ThemedText>
                  </Pressable>
                  {visibleCategories.map((category) => {
                    const selected = selectedCategoryId === category.id;
                    return (
                      <Pressable
                        key={category.id}
                        onPress={() => setSelectedCategoryId(category.id)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected ? theme.primary : theme.backgroundElement,
                          },
                        ]}>
                        <ThemedText
                          type="small"
                          style={selected ? { color: theme.primaryText } : undefined}>
                          {category.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                  {extraCategories.length > 0 ? (
                    <Pressable
                      onPress={() => setMoreCategoriesOpen(true)}
                      style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="small">More</ThemedText>
                    </Pressable>
                  ) : null}
                </ScrollView>
              </View>

              <View style={styles.productsHeader}>
                <ThemedText type="subtitle">Products</ThemedText>
                {checkingStores ? (
                  <View style={styles.checkingRow}>
                    <ActivityIndicator size="small" color={theme.primary} />
                    <ThemedText type="small" themeColor="textSecondary">
                      Checking nearby stores…
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            <ThemedView style={styles.empty}>
              <ThemedText type="small" themeColor="textSecondary">
                {checkingStores
                  ? 'Looking up products at nearby stores…'
                  : debouncedSearch
                    ? 'No products match. Try another search, Clear all in Filters, or another category.'
                    : 'Catalog is empty. Run the campus staple bootstrap on the price proxy, then pull to refresh.'}
              </ThemedText>
            </ThemedView>
          }
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  saleBadge={
                    promotions.has(product.id)
                      ? formatPromotionBadge(promotions.get(product.id)!)
                      : null
                  }
                  quantityOnList={effectiveQtyMap.get(product.id)?.quantity}
                  onPress={() => openProduct(product)}
                  onAdd={() => void handleAdd(product)}
                  onIncrement={() => void handleIncrement(product)}
                  onDecrement={() => void handleDecrement(product)}
                />
              ))}
              {row.length === 1 ? <View style={styles.gridSpacer} /> : null}
            </View>
          )}
        />

        {filtersOpen ? (
          <ShopFiltersDrawer
            key="shop-filters"
            visible
            traits={traits}
            draftRules={sessionRules}
            draftSort={sort}
            draftOnSaleOnly={onSaleOnly}
            onClose={() => setFiltersOpen(false)}
            onResetToPreferences={() => preferenceRules}
            onApply={({ rules, sort: nextSort, onSaleOnly: nextSale }) => {
              setSessionRules(rules);
              setSort(nextSort);
              setOnSaleOnly(nextSale);
              setFiltersOpen(false);
            }}
          />
        ) : null}

        {profileOpen ? (
          <ShopProfileDrawer
            key="shop-profile"
            visible
            displayName={displayName}
            avatarPath={avatarPath}
            avatarVersion={avatarVersion}
            isGuest={isGuest}
            onClose={() => setProfileOpen(false)}
            onSignIn={() => {
              setProfileOpen(false);
              requestSignIn();
            }}
            onSignOut={() => {
              setProfileOpen(false);
              void signOut();
            }}
            onAvatarChanged={(path) => {
              setAvatarPath(path);
              setAvatarVersion(Date.now());
            }}
          />
        ) : null}

        <ProductDetailSheet
          ref={productSheetRef}
          product={selectedProduct}
          saleBadge={
            selectedProduct && promotions.has(selectedProduct.id)
              ? formatPromotionBadge(promotions.get(selectedProduct.id)!)
              : null
          }
          quantityOnList={
            selectedProduct ? effectiveQtyMap.get(selectedProduct.id)?.quantity : undefined
          }
          onAdd={() => selectedProduct && void handleAdd(selectedProduct)}
          onIncrement={() => selectedProduct && void handleIncrement(selectedProduct)}
          onDecrement={() => selectedProduct && void handleDecrement(selectedProduct)}
        />

        <Modal
          visible={moreCategoriesOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setMoreCategoriesOpen(false)}>
          <Pressable style={styles.moreBackdrop} onPress={() => setMoreCategoriesOpen(false)} />
          <View style={[styles.moreSheet, { backgroundColor: theme.background }]}>
            <ThemedText type="subtitle">More categories</ThemedText>
            <ScrollView>
              {extraCategories.map((category) => (
                <Pressable
                  key={category.id}
                  onPress={() => {
                    setSelectedCategoryId(category.id);
                    setMoreCategoriesOpen(false);
                  }}
                  style={styles.moreRow}>
                  <ThemedText>{category.name}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Modal>
    </ThemedView>
  );
}

function formatLocation(location: UserLocation | null) {
  if (!location) return 'No default location saved';
  if (location.label) return location.label;
  const parts = [location.address_line1, location.city, location.region, location.postal_code].filter(
    Boolean,
  );
  return parts.length ? parts.join(', ') : 'Saved location';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  productsHeader: {
    gap: Spacing.two,
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  carousel: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  gridRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  gridSpacer: {
    flex: 1,
  },
  empty: {
    padding: Spacing.four,
    alignItems: 'center',
  },
  edgeHitLeft: {
    position: 'absolute',
    left: 0,
    width: 28,
    bottom: BottomTabInset,
    zIndex: 5,
  },
  edgeHitRight: {
    position: 'absolute',
    right: 0,
    width: 28,
    bottom: BottomTabInset,
    zIndex: 5,
  },
  moreBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  moreSheet: {
    maxHeight: '50%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  moreRow: {
    paddingVertical: Spacing.three,
  },
});
