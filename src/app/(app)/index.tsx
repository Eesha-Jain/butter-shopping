import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
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
  applyCashbackToPriceMap,
  applyFoodFilters,
  ensureCatalogForTerm,
  formatPromotionBadge,
  getActiveListProductQtyMap,
  fetchNearbyShops,
  getCheapestPriceCentsByProductIds,
  getStorePriceCentsByProductIds,
  type OpenPricesGeo,
  getEffectiveGroceryCashbackBps,
  getGuestFavoriteIds,
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
  listMyFavoriteProductIds,
  listMyFoodRules,
  listMyListTargets,
  listMyLocations,
  listMyStapleProductIds,
  listProductsGroupedByCategory,
  listStoreShelf,
  listTrending,
  messageFromUnknown,
  removeListItem,
  resolveSearchCoords,
  resolveShopZip,
  rulesFromUserFoodRules,
  setGuestFavorite,
  setProductFavorite,
  showErrorToast,
  showSuccessToast,
  updateListItem,
  type ActiveListTarget,
  type CategoryProductSection,
  type FoodTrait,
  type NearbyStore,
  type Product,
  type ProductCategory,
  type Promotion,
  type SessionFoodRule,
  type ShopSort,
  type UserLocation,
} from '@/backend';
import { iconForCategory } from '@/components/shop/category-icons';
import { ProductCard } from '@/components/shop/product-card';
import { ProductDetailSheet } from '@/components/shop/product-detail-sheet';
import { ShopFiltersDrawer } from '@/components/shop/shop-filters-drawer';
import { ShopProfileDrawer } from '@/components/shop/shop-profile-drawer';
import { TrendingBlobCard } from '@/components/shop/trending-blob-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const VISIBLE_CATEGORIES = 8;

type ShopListItem =
  | { kind: 'section'; section: CategoryProductSection }
  | { kind: 'row'; products: Product[] };

function productMatchesSearch(product: Product, query: string): boolean {
  const q = query.toLowerCase();
  return (
    product.name.toLowerCase().includes(q) ||
    (product.brand?.toLowerCase().includes(q) ?? false)
  );
}

function searchResultToast(count: number, term: string): void {
  if (count === 0) {
    showSuccessToast('No products found', `for “${term}”`);
    return;
  }
  if (count === 1) {
    showSuccessToast('Found 1 product', `for “${term}”`);
    return;
  }
  showSuccessToast(`Found ${count} products`, `for “${term}”`);
}

export default function ShopScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isGuest, requestSignIn, signOut } = useSession();
  const guestCart = useGuestCart();
  const productSheetRef = useRef<BottomSheetModal>(null);
  const seededPrefsRef = useRef(false);
  const openPricesGeoRef = useRef<OpenPricesGeo | null>(null);

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
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());

  const [staples, setStaples] = useState<Product[]>([]);
  const [staplesArePersonal, setStaplesArePersonal] = useState(false);
  const [trending, setTrending] = useState<{ product: Product; sponsored: boolean }[]>([]);
  const [trendingPrices, setTrendingPrices] = useState<Map<string, number>>(() => new Map());
  const [products, setProducts] = useState<Product[]>([]);
  const [categorySections, setCategorySections] = useState<CategoryProductSection[]>([]);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [expandingCategoryId, setExpandingCategoryId] = useState<string | null>(null);
  const [promotions, setPromotions] = useState<Map<string, Promotion>>(new Map());
  const [checkingStores, setCheckingStores] = useState(false);
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);
  const [selectedStore, setSelectedStore] = useState<NearbyStore | null>(null);
  const [shelfPrices, setShelfPrices] = useState<Map<string, number>>(() => new Map());

  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [preferenceRules, setPreferenceRules] = useState<SessionFoodRule[]>([]);
  const [sessionRules, setSessionRules] = useState<SessionFoodRule[]>([]);
  const [sort, setSort] = useState<ShopSort>('default');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shellReady, setShellReady] = useState(false);

  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchQuery = search.trim();
  const isSearching = searchQuery.length > 0;

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
        try {
          setNearbyStores(await fetchNearbyShops());
        } catch {
          setNearbyStores([]);
        }
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
        if (isGuest) {
          if (!cancelled) setFavoriteIds(new Set(getGuestFavoriteIds()));
          return;
        }
        const ids = await listMyFavoriteProductIds();
        if (!cancelled) setFavoriteIds(new Set(ids));
      } catch {
        if (!cancelled) setFavoriteIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest, shellReady]);

  const favoriteIdsKey = useMemo(
    () => (favoritesOnly ? [...favoriteIds].sort().join(',') : ''),
    [favoriteIds, favoritesOnly],
  );

  useEffect(() => {
    if (!shellReady) return;

    let cancelled = false;
    void (async () => {
      try {
        const collegeId = isGuest ? null : (await getMyProfile()).college_id;
        const groupId = activeTarget?.group.id;
        const coords = await resolveSearchCoords().catch(() => null);
        const openPricesGeo =
          coords != null
            ? { latitude: coords.latitude, longitude: coords.longitude, radiusKm: 80 }
            : null;
        openPricesGeoRef.current = openPricesGeo;

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

        // Personal staples only — campus popular folds into Trending below.
        if (stapleProductIds.length > 0) {
          setStaples(await getProductsByIds(stapleProductIds));
          setStaplesArePersonal(true);
        } else {
          setStaples([]);
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
          }))
          .sort((a, b) => Number(b.sponsored) - Number(a.sponsored));

        // Sponsored + commonly bought first, then campus popular fill (deduped).
        const mergedTrending: { product: Product; sponsored: boolean }[] = [];
        const seenTrending = new Set<string>();
        for (const row of organicTrending) {
          if (seenTrending.has(row.product.id)) continue;
          seenTrending.add(row.product.id);
          mergedTrending.push(row);
        }
        for (const product of popularCampus) {
          if (seenTrending.has(product.id)) continue;
          seenTrending.add(product.id);
          mergedTrending.push({ product, sponsored: false });
        }
        setTrending(mergedTrending);
        const trendingPriceMap = await getCheapestPriceCentsByProductIds(
          mergedTrending.map((row) => row.product.id),
          openPricesGeo,
        );
        if (cancelled) return;
        setTrendingPrices(trendingPriceMap);

        const browseHome = !favoritesOnly && selectedCategoryId == null && selectedStore == null;
        const stapleIds = new Set(stapleProductIds);
        const promotionProductIds = new Set(promoMap.keys());

        if (selectedStore) {
          setCategorySections([]);
          setExpandedCategoryIds(new Set());
          let rawProducts: Product[];
          let priceMap: Map<string, number>;
          if (favoritesOnly) {
            const ids = favoriteIdsKey ? favoriteIdsKey.split(',') : [];
            rawProducts = ids.length > 0 ? await getProductsByIds(ids) : [];
            if (selectedCategoryId) {
              rawProducts = rawProducts.filter((row) => row.category_id === selectedCategoryId);
            }
            priceMap = await getStorePriceCentsByProductIds(
              selectedStore.id,
              rawProducts.map((row) => row.id),
            );
            rawProducts = rawProducts.filter((row) => priceMap.has(row.id));
          } else {
            const shelf = await listStoreShelf(selectedStore.id, {
              limit: 60,
              categoryId: selectedCategoryId,
            });
            rawProducts = shelf.map((row) => row.product);
            priceMap = new Map(shelf.map((row) => [row.product.id, row.priceCents]));
          }
          if (cancelled) return;
          const [traitsForProducts, cashbackBps] = await Promise.all([
            getProductTraitsForIds(rawProducts.map((row) => row.id)),
            getEffectiveGroceryCashbackBps(isGuest),
          ]);
          if (cancelled) return;
          const netPriceMap = applyCashbackToPriceMap(priceMap, cashbackBps);
          setShelfPrices(netPriceMap);
          setProducts(
            applyFoodFilters(rawProducts, sessionRules, indexTraitsByProduct(traitsForProducts), {
              sort,
              stapleIds,
              onSaleOnly,
              promotionProductIds,
              priceCentsByProduct: netPriceMap,
            }),
          );
          if (!cancelled) setCheckingStores(false);
        } else if (browseHome) {
          const [grouped, catalogProducts] = await Promise.all([
            listProductsGroupedByCategory({ limitPerCategory: 10 }),
            listActiveProducts({ limit: 60 }),
          ]);
          if (cancelled) return;

          const sectionIds = grouped.flatMap((section) => section.products.map((row) => row.id));
          const catalogIds = catalogProducts.map((row) => row.id);
          const allIds = [...new Set([...sectionIds, ...catalogIds])];
          const [traitsForProducts, priceMap, cashbackBps] = await Promise.all([
            getProductTraitsForIds(allIds),
            getCheapestPriceCentsByProductIds(allIds, openPricesGeo),
            getEffectiveGroceryCashbackBps(isGuest),
          ]);
          if (cancelled) return;
          const netPriceMap = applyCashbackToPriceMap(priceMap, cashbackBps);
          setShelfPrices(netPriceMap);

          const traitsByProduct = indexTraitsByProduct(traitsForProducts);
          const filterOpts = {
            sort,
            stapleIds,
            onSaleOnly,
            promotionProductIds,
            priceCentsByProduct: netPriceMap,
          };
          setCategorySections(
            grouped
              .map((section) => ({
                category: section.category,
                products: applyFoodFilters(
                  section.products,
                  sessionRules,
                  traitsByProduct,
                  filterOpts,
                ),
              }))
              .filter((section) => section.products.length > 0),
          );
          setProducts(
            applyFoodFilters(catalogProducts, sessionRules, traitsByProduct, filterOpts),
          );
          setExpandedCategoryIds(new Set());
          if (!cancelled) setCheckingStores(false);
        } else {
          setCategorySections([]);
          setExpandedCategoryIds(new Set());

          let rawProducts: Product[];
          if (favoritesOnly) {
            const ids = favoriteIdsKey ? favoriteIdsKey.split(',') : [];
            rawProducts = ids.length > 0 ? await getProductsByIds(ids) : [];
            if (selectedCategoryId) {
              rawProducts = rawProducts.filter((row) => row.category_id === selectedCategoryId);
            }
          } else {
            rawProducts = await listActiveProducts({
              categoryId: selectedCategoryId,
              limit: 60,
            });
          }
          if (cancelled) return;

          const [traitsForProducts, priceMap, cashbackBps] = await Promise.all([
            getProductTraitsForIds(rawProducts.map((row) => row.id)),
            getCheapestPriceCentsByProductIds(rawProducts.map((row) => row.id), openPricesGeo),
            getEffectiveGroceryCashbackBps(isGuest),
          ]);
          if (cancelled) return;
          const netPriceMap = applyCashbackToPriceMap(priceMap, cashbackBps);
          setShelfPrices(netPriceMap);

          setProducts(
            applyFoodFilters(rawProducts, sessionRules, indexTraitsByProduct(traitsForProducts), {
              sort,
              stapleIds,
              onSaleOnly,
              promotionProductIds,
              priceCentsByProduct: netPriceMap,
            }),
          );
          if (!cancelled) setCheckingStores(false);
        }

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
    favoriteIdsKey,
    favoritesOnly,
    isGuest,
    onSaleOnly,
    refreshQtyMap,
    selectedCategoryId,
    selectedStore,
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

  const handleSearchSubmit = async () => {
    const term = search.trim();
    Keyboard.dismiss();
    if (!term) return;

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Unsupported platforms no-op.
    }

    const localMatches = products.filter((row) => productMatchesSearch(row, term));
    searchResultToast(localMatches.length, term);

    if (favoritesOnly || term.length < 2 || localMatches.length >= 3) return;

    setCheckingStores(true);
    try {
      const zip = await resolveShopZip();
      let rawProducts = await ensureCatalogForTerm(term, zip);
      if (selectedCategoryId) {
        rawProducts = rawProducts.filter((row) => row.category_id === selectedCategoryId);
      }
      let priceMap = await (selectedStore
        ? getStorePriceCentsByProductIds(
            selectedStore.id,
            rawProducts.map((row) => row.id),
          )
        : getCheapestPriceCentsByProductIds(
            rawProducts.map((row) => row.id),
            openPricesGeoRef.current,
          ));
      if (selectedStore) {
        rawProducts = rawProducts.filter((row) => priceMap.has(row.id));
      }
      const [traitsForProducts, cashbackBps] = await Promise.all([
        getProductTraitsForIds(rawProducts.map((row) => row.id)),
        getEffectiveGroceryCashbackBps(isGuest),
      ]);
      const netPriceMap = applyCashbackToPriceMap(priceMap, cashbackBps);
      setShelfPrices(netPriceMap);
      const filtered = applyFoodFilters(
        rawProducts,
        sessionRules,
        indexTraitsByProduct(traitsForProducts),
        {
          sort,
          stapleIds: new Set(staples.map((row) => row.id)),
          onSaleOnly,
          promotionProductIds: new Set(promotions.keys()),
          priceCentsByProduct: netPriceMap,
        },
      );
      setProducts(filtered);
      searchResultToast(
        filtered.filter((row) => productMatchesSearch(row, term)).length,
        term,
      );
    } catch (err) {
      showErrorToast(err, 'Could not check nearby stores.');
    } finally {
      setCheckingStores(false);
    }
  };

  const handleToggleFavorite = async (productId: string) => {
    const favored = !favoriteIds.has(productId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (favored) next.add(productId);
      else next.delete(productId);
      return next;
    });
    try {
      if (isGuest) {
        setGuestFavorite(productId, favored);
      } else {
        await setProductFavorite(productId, favored);
      }
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Unsupported platforms no-op.
      }
    } catch (err) {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (favored) next.delete(productId);
        else next.add(productId);
        return next;
      });
      showErrorToast(err, 'Could not update favorite.');
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

  const sectionedHome =
    !favoritesOnly && !isSearching && selectedCategoryId == null && selectedStore == null;

  const displayProducts = useMemo(() => {
    if (!isSearching) return products;
    return products.filter((row) => productMatchesSearch(row, searchQuery));
  }, [isSearching, products, searchQuery]);

  const displayTrending = useMemo(() => {
    if (!selectedCategoryId) return trending;
    return trending.filter((row) => row.product.category_id === selectedCategoryId);
  }, [selectedCategoryId, trending]);

  const displayStaples = useMemo(() => {
    if (!selectedCategoryId) return staples;
    return staples.filter((product) => product.category_id === selectedCategoryId);
  }, [selectedCategoryId, staples]);

  const listData = useMemo((): ShopListItem[] => {
    if (sectionedHome) {
      return categorySections.map((section) => ({
        kind: 'section' as const,
        section,
      }));
    }
    const rows: Product[][] = [];
    for (let i = 0; i < displayProducts.length; i += 2) {
      rows.push(displayProducts.slice(i, i + 2));
    }
    return rows.map((row) => ({ kind: 'row' as const, products: row }));
  }, [categorySections, displayProducts, sectionedHome]);

  const toggleCategoryExpand = async (categoryId: string) => {
    if (expandedCategoryIds.has(categoryId)) {
      setExpandedCategoryIds((prev) => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
      return;
    }

    setExpandingCategoryId(categoryId);
    try {
      const shelf = selectedStore
        ? await listStoreShelf(selectedStore.id, { categoryId, limit: 40 })
        : null;
      const rawProducts = shelf
        ? shelf.map((row) => row.product)
        : await listActiveProducts({ categoryId, limit: 40 });
      const priceMap = shelf
        ? new Map(shelf.map((row) => [row.product.id, row.priceCents]))
        : await getCheapestPriceCentsByProductIds(
            rawProducts.map((row) => row.id),
            openPricesGeoRef.current,
          );
      const [traitsForProducts, cashbackBps] = await Promise.all([
        getProductTraitsForIds(rawProducts.map((row) => row.id)),
        getEffectiveGroceryCashbackBps(isGuest),
      ]);
      const netPriceMap = applyCashbackToPriceMap(priceMap, cashbackBps);
      setShelfPrices((prev) => {
        const next = new Map(prev);
        for (const [id, cents] of netPriceMap) next.set(id, cents);
        return next;
      });
      const stapleIds = new Set(staples.map((row) => row.id));
      const filtered = applyFoodFilters(
        rawProducts,
        sessionRules,
        indexTraitsByProduct(traitsForProducts),
        {
          sort,
          stapleIds,
          onSaleOnly,
          promotionProductIds: new Set(promotions.keys()),
          priceCentsByProduct: netPriceMap,
        },
      );
      setCategorySections((prev) =>
        prev.map((section) =>
          section.category.id === categoryId ? { ...section, products: filtered } : section,
        ),
      );
      setExpandedCategoryIds((prev) => new Set(prev).add(categoryId));
    } catch (err) {
      showErrorToast(err, 'Could not load more products.');
    } finally {
      setExpandingCategoryId(null);
    }
  };

  const renderProductCard = (product: Product, compact?: boolean) => (
    <ProductCard
      key={product.id}
      product={product}
      compact={compact}
      saleBadge={
        promotions.has(product.id) ? formatPromotionBadge(promotions.get(product.id)!) : null
      }
      quantityOnList={effectiveQtyMap.get(product.id)?.quantity}
      favorited={favoriteIds.has(product.id)}
      priceCents={shelfPrices.get(product.id)}
      onPress={() => openProduct(product)}
      onAdd={() => void handleAdd(product)}
      onIncrement={() => void handleIncrement(product)}
      onDecrement={() => void handleDecrement(product)}
      onToggleFavorite={() => void handleToggleFavorite(product.id)}
    />
  );

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
          data={listData}
          extraData={`${selectedCategoryId ?? 'all'}:${favoritesOnly ? 'fav' : 'all'}:${searchQuery}:${[...favoriteIds].join(',')}:${[...expandedCategoryIds].join(',')}:${expandingCategoryId ?? ''}`}
          keyExtractor={(item) =>
            item.kind === 'section'
              ? item.section.category.id
              : item.products.map((product) => product.id).join('-') || 'empty'
          }
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

              {nearbyStores.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}>
                  <Pressable
                    onPress={() => setSelectedStore(null)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          selectedStore == null ? theme.primary : theme.backgroundElement,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={selectedStore == null ? { color: theme.primaryText } : undefined}>
                      All stores
                    </ThemedText>
                  </Pressable>
                  {nearbyStores.map((store) => {
                    const selected = selectedStore?.id === store.id;
                    return (
                      <Pressable
                        key={store.id}
                        onPress={() => setSelectedStore(store)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected ? theme.primary : theme.backgroundElement,
                          },
                        ]}>
                        <ThemedText
                          type="small"
                          numberOfLines={1}
                          style={selected ? { color: theme.primaryText } : undefined}>
                          {store.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              <View style={styles.searchRow}>
                <View
                  style={[
                    styles.searchField,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                    size={18}
                    tintColor={theme.textSecondary}
                  />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search products"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.searchInput, { color: theme.text }]}
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="while-editing"
                    returnKeyType="search"
                    onSubmitEditing={() => void handleSearchSubmit()}
                    accessibilityLabel="Search products"
                  />
                </View>
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

              <View style={styles.section}>
                <ThemedText type="subtitle">Category</ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}>
                  <Pressable
                    onPress={() => {
                      setSelectedCategoryId(null);
                      setSearch('');
                    }}
                    style={[
                      styles.chip,
                      styles.chipWithIcon,
                      {
                        backgroundColor:
                          selectedCategoryId == null && !favoritesOnly
                            ? theme.primary
                            : theme.backgroundElement,
                      },
                    ]}>
                    <SymbolView
                      name={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
                      size={16}
                      tintColor={
                        selectedCategoryId == null && !favoritesOnly
                          ? theme.primaryText
                          : theme.text
                      }
                    />
                    <ThemedText
                      type="small"
                      style={
                        selectedCategoryId == null && !favoritesOnly
                          ? { color: theme.primaryText }
                          : undefined
                      }>
                      All
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setFavoritesOnly((value) => !value)}
                    style={[
                      styles.chip,
                      styles.chipWithIcon,
                      {
                        backgroundColor: favoritesOnly ? theme.primary : theme.backgroundElement,
                      },
                    ]}>
                    <SymbolView
                      name={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }}
                      size={16}
                      tintColor={favoritesOnly ? theme.primaryText : theme.text}
                    />
                    <ThemedText
                      type="small"
                      style={favoritesOnly ? { color: theme.primaryText } : undefined}>
                      Favorites
                    </ThemedText>
                  </Pressable>
                  {visibleCategories.map((category) => {
                    const selected = selectedCategoryId === category.id;
                    const symbol = iconForCategory(category.name);
                    return (
                      <Pressable
                        key={category.id}
                        onPress={() => {
                          setSelectedCategoryId(category.id);
                          setSearch('');
                        }}
                        style={[
                          styles.chip,
                          styles.chipWithIcon,
                          {
                            backgroundColor: selected ? theme.primary : theme.backgroundElement,
                          },
                        ]}>
                        <SymbolView
                          name={{ ios: symbol, android: 'label', web: 'label' }}
                          size={16}
                          tintColor={selected ? theme.primaryText : theme.text}
                        />
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
                      style={[
                        styles.chip,
                        styles.chipWithIcon,
                        { backgroundColor: theme.backgroundElement },
                      ]}>
                      <SymbolView
                        name={{ ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }}
                        size={16}
                        tintColor={theme.text}
                      />
                      <ThemedText type="small">More</ThemedText>
                    </Pressable>
                  ) : null}
                </ScrollView>
              </View>

              {displayTrending.length > 0 && !favoritesOnly && !isSearching && !selectedStore ? (
                <View style={styles.section}>
                  <ThemedText type="subtitle">Trending</ThemedText>
                  <FlatList
                    horizontal
                    data={displayTrending}
                    keyExtractor={(item) => item.product.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.carousel}
                    renderItem={({ item, index }) => (
                      <TrendingBlobCard
                        product={item.product}
                        index={index}
                        sponsored={item.sponsored}
                        saleBadge={
                          promotions.has(item.product.id)
                            ? formatPromotionBadge(promotions.get(item.product.id)!)
                            : null
                        }
                        priceCents={trendingPrices.get(item.product.id) ?? null}
                        quantityOnList={effectiveQtyMap.get(item.product.id)?.quantity}
                        favorited={favoriteIds.has(item.product.id)}
                        onPress={() => openProduct(item.product)}
                        onAdd={() => void handleAdd(item.product)}
                        onIncrement={() => void handleIncrement(item.product)}
                        onDecrement={() => void handleDecrement(item.product)}
                        onToggleFavorite={() => void handleToggleFavorite(item.product.id)}
                      />
                    )}
                  />
                </View>
              ) : null}

              {staplesArePersonal && displayStaples.length > 0 && !favoritesOnly && !isSearching && !selectedStore ? (
                <View style={styles.section}>
                  <ThemedText type="subtitle">Your staples</ThemedText>
                  <FlatList
                    horizontal
                    data={displayStaples}
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
                        favorited={favoriteIds.has(item.id)}
                        onPress={() => openProduct(item)}
                        onAdd={() => void handleAdd(item)}
                        onIncrement={() => void handleIncrement(item)}
                        onDecrement={() => void handleDecrement(item)}
                        onToggleFavorite={() => void handleToggleFavorite(item.id)}
                      />
                    )}
                  />
                </View>
              ) : null}

              {!sectionedHome ? (
                <View style={styles.productsHeader}>
                  <ThemedText type="subtitle">
                    {selectedStore
                      ? selectedStore.name
                      : isSearching
                      ? `Results for “${searchQuery}”`
                      : favoritesOnly
                        ? 'Favorites'
                        : selectedCategoryId
                          ? (categories.find((row) => row.id === selectedCategoryId)?.name ??
                            'Products')
                          : 'Products'}
                  </ThemedText>
                  {checkingStores ? (
                    <View style={styles.checkingRow}>
                      <ActivityIndicator size="small" color={theme.primary} />
                      <ThemedText type="small" themeColor="textSecondary">
                        Checking nearby stores…
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <ThemedView style={styles.empty}>
              <ThemedText type="small" themeColor="textSecondary">
                {checkingStores
                  ? 'Looking up products at nearby stores…'
                  : selectedStore
                    ? `${selectedStore.name} has no matching items in stock.`
                    : favoritesOnly && !isSearching
                    ? 'No favorites yet. Tap the heart on a product to save it here.'
                    : isSearching
                      ? 'No products match. Try another search, Clear all in Filters, or another category.'
                      : 'Catalog is empty. Run the campus staple bootstrap on the price proxy, then pull to refresh.'}
              </ThemedText>
            </ThemedView>
          }
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              const section = item.section;
              const expanded = expandedCategoryIds.has(section.category.id);
              const expanding = expandingCategoryId === section.category.id;
              if (expanded) {
                const rows: Product[][] = [];
                for (let i = 0; i < section.products.length; i += 2) {
                  rows.push(section.products.slice(i, i + 2));
                }
                return (
                  <View style={styles.categorySection}>
                    <View style={styles.sectionTitleRow}>
                      <ThemedText type="subtitle" style={styles.flex}>
                        {section.category.name}
                      </ThemedText>
                      <Pressable
                        onPress={() => void toggleCategoryExpand(section.category.id)}
                        hitSlop={8}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Show less
                        </ThemedText>
                      </Pressable>
                    </View>
                    {rows.map((row) => (
                      <View
                        key={row.map((product) => product.id).join('-')}
                        style={styles.gridRow}>
                        {row.map((product) => renderProductCard(product))}
                        {row.length === 1 ? <View style={styles.gridSpacer} /> : null}
                      </View>
                    ))}
                  </View>
                );
              }

              return (
                <View style={styles.categorySection}>
                  <View style={styles.sectionTitleRow}>
                    <ThemedText type="subtitle" style={styles.flex}>
                      {section.category.name}
                    </ThemedText>
                    <Pressable
                      onPress={() => void toggleCategoryExpand(section.category.id)}
                      hitSlop={8}
                      disabled={expanding}>
                      {expanding ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                          See more
                        </ThemedText>
                      )}
                    </Pressable>
                  </View>
                  <FlatList
                    horizontal
                    data={section.products}
                    keyExtractor={(product) => product.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.carousel}
                    renderItem={({ item: product }) => renderProductCard(product, true)}
                  />
                </View>
              );
            }

            return (
              <View style={styles.gridRow}>
                {item.products.map((product) => renderProductCard(product))}
                {item.products.length === 1 ? <View style={styles.gridSpacer} /> : null}
              </View>
            );
          }}
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
          favorited={selectedProduct ? favoriteIds.has(selectedProduct.id) : false}
          onAdd={() => selectedProduct && void handleAdd(selectedProduct)}
          onIncrement={() => selectedProduct && void handleIncrement(selectedProduct)}
          onDecrement={() => selectedProduct && void handleDecrement(selectedProduct)}
          onToggleFavorite={() =>
            selectedProduct && void handleToggleFavorite(selectedProduct.id)
          }
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
              {extraCategories.map((category) => {
                const symbol = iconForCategory(category.name);
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => {
                      setSelectedCategoryId(category.id);
                      setSearch('');
                      setMoreCategoriesOpen(false);
                    }}
                    style={styles.moreRow}>
                    <SymbolView
                      name={{ ios: symbol, android: 'label', web: 'label' }}
                      size={20}
                      tintColor={theme.text}
                    />
                    <ThemedText>{category.name}</ThemedText>
                  </Pressable>
                );
              })}
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
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  searchInput: {
    flex: 1,
    padding: 0,
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
  chipWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  categorySection: {
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
