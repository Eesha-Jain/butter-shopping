import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
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
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveList } from '@/auth/active-list';
import { useGuestCart } from '@/auth/guest-cart-context';
import { useSession } from '@/auth/session';
import {
  addListItem,
  applyCashbackToPriceMap,
  applyFoodFilters,
  ensureCatalogForTerm,
  formatPromotionBadge,
  promotionSavingsHint,
  shelfSaleHint,
  getActiveListProductQtyMap,
  fetchNearbyShops,
  getCheapestPriceCentsByProductIds,
  getCheapestShelfSaleByProductIds,
  getStorePriceCentsByProductIds,
  type OpenPricesGeo,
  getEffectiveGroceryCashbackBps,
  getGuestFavoriteIds,
  getGuestFoodRules,
  getGuestOnboardingDraft,
  getMyProfile,
  saveGuestOnboardingDraft,
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
  listMyLocations,
  listMyStapleProductIds,
  listProductsGroupedByCategory,
  listStoreShelf,
  listTrending,
  messageFromUnknown,
  publicImageUrl,
  removeListItem,
  resolveSearchCoords,
  resolveShopZip,
  rulesFromUserFoodRules,
  setGuestFavorite,
  setProductFavorite,
  showErrorToast,
  showSuccessToast,
  updateListItem,
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
import { CategoryIcon } from '@/components/shop/category-icons';
import { ProductCard } from '@/components/shop/product-card';
import { ProductDetailSheet } from '@/components/shop/product-detail-sheet';
import { ProductPeek } from '@/components/shop/product-peek';
import { ShopFiltersDrawer } from '@/components/shop/shop-filters-drawer';
import { ShopProfileDrawer } from '@/components/shop/shop-profile-drawer';
import { SnapBadge } from '@/components/shop/snap-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterChip } from '@/components/ui/butter-chip';
import { ButterSearchField } from '@/components/ui/butter-search-field';
import { BottomTabInset, Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useSnapOptedIn } from '@/hooks/use-snap-opted-in';
import { useTheme } from '@/hooks/use-theme';

function categoryIsSnapEligible(category: ProductCategory | undefined): boolean {
  if (!category) return false;
  if (typeof category.snap_eligible === 'boolean') return category.snap_eligible;
  return category.name.toLowerCase() !== 'other';
}

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

function chunkProducts(products: Product[], size = 2): Product[][] {
  const rows: Product[][] = [];
  for (let i = 0; i < products.length; i += size) {
    rows.push(products.slice(i, i + size));
  }
  return rows;
}

const AISLE_PREVIEW_COUNT = 4;

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
  const snapOptedIn = useSnapOptedIn();
  const {
    targets: listTargets,
    activeTarget,
    setActiveTarget,
    refreshTargets,
  } = useActiveList();
  const guestCart = useGuestCart();
  const productSheetRef = useRef<BottomSheetModal>(null);
  const seededPrefsRef = useRef(false);
  const openPricesGeoRef = useRef<OpenPricesGeo | null>(null);

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [location, setLocation] = useState<UserLocation | null>(null);
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
  const [promotions, setPromotions] = useState<Map<string, Promotion>>(new Map());
  const [shelfSales, setShelfSales] = useState<
    Map<string, NonNullable<ReturnType<typeof shelfSaleHint>>>
  >(() => new Map());
  const [checkingStores, setCheckingStores] = useState(false);
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);
  const [selectedStore, setSelectedStore] = useState<NearbyStore | null>(null);
  const [shelfPrices, setShelfPrices] = useState<Map<string, number>>(() => new Map());
  const [cashbackBps, setCashbackBps] = useState<number | null>(null);

  const refreshShelfSales = useCallback(async (ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) {
      setShelfSales(new Map());
      return new Set<string>();
    }
    try {
      const rows = await getCheapestShelfSaleByProductIds(unique);
      const next = new Map<string, NonNullable<ReturnType<typeof shelfSaleHint>>>();
      for (const [id, row] of rows) {
        const hint = shelfSaleHint(row.priceCents, row.regularPriceCents);
        if (hint) next.set(id, hint);
      }
      setShelfSales(next);
      return new Set(next.keys());
    } catch {
      setShelfSales(new Map());
      return new Set<string>();
    }
  }, []);

  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [preferenceRules, setPreferenceRules] = useState<SessionFoodRule[]>([]);
  const [sessionRules, setSessionRules] = useState<SessionFoodRule[]>([]);
  const [sort, setSort] = useState<ShopSort>('default');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shellReady, setShellReady] = useState(false);

  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [peekProduct, setPeekProduct] = useState<Product | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchQuery = search.trim();
  const isSearching = searchQuery.length > 0;

  const traitsById = useMemo(() => new Map(traits.map((trait) => [trait.id, trait])), [traits]);
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const productShowsSnap = useCallback(
    (product: Product) =>
      snapOptedIn && categoryIsSnapEligible(categoryById.get(product.category_id ?? '')),
    [snapOptedIn, categoryById],
  );

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    const modePrefix: Record<SessionFoodRule['mode'], string> = {
      avoid: 'Avoid',
      prefer: 'Prefer',
      require: 'Must',
    };
    for (const rule of sessionRules) {
      const trait = traitsById.get(rule.trait_id);
      const name = trait?.name ?? 'Filter';
      chips.push({
        key: `${rule.mode}:${rule.trait_id}`,
        label: `${modePrefix[rule.mode]}: ${name}`,
        onRemove: () => {
          setSessionRules((prev) => {
            const next = prev.filter((row) => row.trait_id !== rule.trait_id);
            if (isGuest) {
              saveGuestOnboardingDraft({
                ...getGuestOnboardingDraft(),
                foodRules: next,
              });
              setPreferenceRules(next);
            }
            return next;
          });
        },
      });
    }
    if (onSaleOnly) {
      chips.push({
        key: 'on-sale',
        label: 'On sale',
        onRemove: () => setOnSaleOnly(false),
      });
    }
    return chips;
  }, [isGuest, onSaleOnly, sessionRules, traitsById]);

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
          const guestPrefs = getGuestFoodRules();
          setPreferenceRules(guestPrefs);
          if (!seededPrefsRef.current || refresh) {
            setSessionRules(guestPrefs);
            seededPrefsRef.current = true;
          }
        } else {
          const [locations, foodRules, profile] = await Promise.all([
            listMyLocations(),
            listMyFoodRules(),
            getMyProfile(),
          ]);
          await refreshTargets();
          setLocation(locations.find((row) => row.is_default) ?? locations[0] ?? null);
          setDisplayName(profile.display_name);
          setAvatarPath(profile.avatar_path);
          const prefs = rulesFromUserFoodRules(foodRules);
          setPreferenceRules(prefs);
          if (!seededPrefsRef.current || refresh) {
            setSessionRules(prefs);
            seededPrefsRef.current = true;
          }
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
    [isGuest, refreshTargets],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadShell();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadShell]);

  useEffect(() => {
    if (isGuest || !activeTarget) return;
    const timer = setTimeout(() => {
      void refreshQtyMap(activeTarget.list.id);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeTarget, isGuest, refreshQtyMap]);

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
        setShelfPrices((prev) => {
          const next = new Map(prev);
          for (const [id, cents] of trendingPriceMap) next.set(id, cents);
          return next;
        });

        const browseHome = !favoritesOnly && selectedCategoryId == null && selectedStore == null;
        const stapleIds = new Set(stapleProductIds);
        const promotionProductIds = new Set(promoMap.keys());

        if (selectedStore) {
          setCategorySections([]);
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
          const [traitsForProducts, nextCashbackBps] = await Promise.all([
            getProductTraitsForIds(rawProducts.map((row) => row.id)),
            getEffectiveGroceryCashbackBps(isGuest),
          ]);
          if (cancelled) return;
          const netPriceMap = applyCashbackToPriceMap(priceMap, nextCashbackBps);
          setCashbackBps(nextCashbackBps);
          setShelfPrices(netPriceMap);
          const shelfSaleIds = await refreshShelfSales(rawProducts.map((row) => row.id));
          const saleIds = new Set([...promotionProductIds, ...shelfSaleIds]);
          setProducts(
            applyFoodFilters(rawProducts, sessionRules, indexTraitsByProduct(traitsForProducts), {
              sort,
              stapleIds,
              onSaleOnly,
              promotionProductIds: saleIds,
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
          const [traitsForProducts, priceMap, nextCashbackBps] = await Promise.all([
            getProductTraitsForIds(allIds),
            getCheapestPriceCentsByProductIds(allIds, openPricesGeo),
            getEffectiveGroceryCashbackBps(isGuest),
          ]);
          if (cancelled) return;
          const netPriceMap = applyCashbackToPriceMap(priceMap, nextCashbackBps);
          setCashbackBps(nextCashbackBps);
          setShelfPrices(netPriceMap);
          const [shelfSaleIds, enrichedPromo] = await Promise.all([
            refreshShelfSales(allIds),
            getProductPromotionMap(allIds),
          ]);
          if (!cancelled) setPromotions(enrichedPromo);
          const saleIds = new Set([...enrichedPromo.keys(), ...shelfSaleIds]);

          const traitsByProduct = indexTraitsByProduct(traitsForProducts);
          const filterOpts = {
            sort,
            stapleIds,
            onSaleOnly,
            promotionProductIds: saleIds,
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
          if (!cancelled) setCheckingStores(false);
        } else {
          setCategorySections([]);

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

          const [traitsForProducts, priceMap, nextCashbackBps] = await Promise.all([
            getProductTraitsForIds(rawProducts.map((row) => row.id)),
            getCheapestPriceCentsByProductIds(rawProducts.map((row) => row.id), openPricesGeo),
            getEffectiveGroceryCashbackBps(isGuest),
          ]);
          if (cancelled) return;
          const netPriceMap = applyCashbackToPriceMap(priceMap, nextCashbackBps);
          setCashbackBps(nextCashbackBps);
          setShelfPrices(netPriceMap);
          const productIds = rawProducts.map((row) => row.id);
          const [shelfSaleIds, enrichedPromo] = await Promise.all([
            refreshShelfSales(productIds),
            getProductPromotionMap(productIds),
          ]);
          if (!cancelled) setPromotions(enrichedPromo);

          setProducts(
            applyFoodFilters(rawProducts, sessionRules, indexTraitsByProduct(traitsForProducts), {
              sort,
              stapleIds,
              onSaleOnly,
              promotionProductIds: new Set([...enrichedPromo.keys(), ...shelfSaleIds]),
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
    refreshShelfSales,
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

  const avatarBaseUrl = publicImageUrl('avatars', avatarPath);
  const avatarUrl = avatarBaseUrl ? `${avatarBaseUrl}?t=${avatarVersion}` : null;
  const headerName = isGuest ? 'Guest' : displayName?.trim() || 'Butter shopper';

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
    return chunkProducts(displayProducts).map((row) => ({
      kind: 'row' as const,
      products: row,
    }));
  }, [categorySections, displayProducts, sectionedHome]);

  const enterAisle = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setFavoritesOnly(false);
    setSearch('');
  };

  const openPeek = (product: Product) => {
    setPeekProduct(product);
  };

  const closePeek = () => {
    setPeekProduct(null);
  };

  const openFullFromPeek = () => {
    const product = peekProduct;
    setPeekProduct(null);
    if (product) openProduct(product);
  };

  const renderProductCard = (product: Product, index = 0) => {
    const promo = promotions.get(product.id) ?? null;
    const priceCents = shelfPrices.get(product.id) ?? null;
    const shelfHint = !promo ? (shelfSales.get(product.id) ?? null) : null;
    const hint = promo ? promotionSavingsHint(promo, priceCents) : shelfHint;
    const saleBadge = promo
      ? formatPromotionBadge(promo)
      : (shelfHint?.badge ?? null);
    const priceNote =
      !promo && !shelfHint && cashbackBps != null && cashbackBps > 0 && priceCents != null
        ? 'after cash back'
        : null;
    return (
      <ProductCard
        key={product.id}
        product={product}
        index={index}
        saleBadge={saleBadge}
        compareAtCents={hint?.compareAtCents}
        savingsLabel={hint?.savingsLabel}
        priceNote={priceNote}
        showSnap={productShowsSnap(product)}
        quantityOnList={effectiveQtyMap.get(product.id)?.quantity}
        priceCents={priceCents}
        onPress={() => openProduct(product)}
        onLongPress={() => openPeek(product)}
        onAdd={() => void handleAdd(product)}
        onIncrement={() => void handleIncrement(product)}
        onDecrement={() => void handleDecrement(product)}
      />
    );
  };

  const renderProductGrid = (products: Product[]) =>
    chunkProducts(products).map((row) => (
      <View key={row.map((product) => product.id).join('-')} style={styles.gridRow}>
        {row.map((product, index) => renderProductCard(product, index))}
        {row.length === 1 ? <View style={styles.gridSpacer} /> : null}
      </View>
    ));

  const focusedAisleName = selectedCategoryId
    ? (categories.find((row) => row.id === selectedCategoryId)?.name ?? 'Aisle')
    : null;

  const dealsStripLabel = (() => {
    const parts: string[] = [];
    if (promotions.size > 0) {
      parts.push(`${promotions.size} deal${promotions.size === 1 ? '' : 's'} near you`);
    }
    if (cashbackBps != null && cashbackBps > 0) {
      parts.push(`Prices include ${cashbackBps / 100}% cash back`);
    }
    return parts.join(' · ');
  })();

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
          extraData={`${selectedCategoryId ?? 'all'}:${favoritesOnly ? 'fav' : 'all'}:${searchQuery}:${sort}:${onSaleOnly ? 'sale' : ''}:${cashbackBps ?? ''}:${[...favoriteIds].join(',')}`}
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
            <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
              <View style={styles.brandRow}>
                <Pressable
                  onPress={openProfile}
                  hitSlop={8}
                  style={[
                    styles.avatarBtn,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open profile">
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
                  ) : (
                    <SymbolView
                      name={{
                        ios: 'person.crop.circle.fill',
                        android: 'account_circle',
                        web: 'account_circle',
                      }}
                      size={28}
                      tintColor={theme.textSecondary}
                    />
                  )}
                </Pressable>
                <View style={styles.flex}>
                  <ThemedText type="smallBold" style={styles.brandTitle} numberOfLines={1}>
                    {headerName}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    Pick an aisle. Spot a deal. Add to your list.
                  </ThemedText>
                  <Pressable
                    onPress={() => {
                      if (isGuest || listTargets.length <= 1) return;
                      const idx = listTargets.findIndex((t) => t.list.id === activeTarget?.list.id);
                      const next = listTargets[(idx + 1) % listTargets.length];
                      if (next) {
                        setActiveTarget(next);
                        void refreshQtyMap(next.list.id);
                      }
                    }}
                    disabled={isGuest || listTargets.length <= 1}
                    hitSlop={6}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {isGuest
                        ? `Near you · guest cart`
                        : `Near ${formatLocation(location)}${
                            activeTarget?.group.name
                              ? ` · ${activeTarget.group.name}${
                                  listTargets.length > 1 ? ' · tap to switch' : ''
                                }`
                              : ''
                          }`}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>

              <View style={styles.searchRow}>
                <ButterSearchField
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search products"
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                  onSubmitEditing={() => void handleSearchSubmit()}
                  accessibilityLabel="Search products"
                />
                <Pressable
                  onPress={() => {
                    openFilters();
                  }}
                  style={[
                    styles.iconBtn,
                    styles.filterBtn,
                    { backgroundColor: theme.secondary },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open filters">
                  <SymbolView
                    name={{
                      ios: 'line.3.horizontal.decrease',
                      android: 'filter_list',
                      web: 'filter_list',
                    }}
                    size={22}
                    tintColor={theme.primary}
                  />
                </Pressable>
              </View>

              {dealsStripLabel ? (
                <Pressable
                  onPress={() => setOnSaleOnly((value) => !value)}
                  style={[
                    styles.dealsStrip,
                    {
                      backgroundColor: onSaleOnly
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: onSaleOnly }}
                  accessibilityLabel={
                    onSaleOnly ? 'Showing deals only, tap to clear' : 'Show deals only'
                  }>
                  <ThemedText type="smallBold" style={{ color: theme.primaryDark }}>
                    {dealsStripLabel}
                    {onSaleOnly ? ' · On' : ''}
                  </ThemedText>
                </Pressable>
              ) : null}

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}>
                <ButterChip
                  label="All"
                  selected={selectedCategoryId == null && !favoritesOnly}
                  onPress={() => {
                    setSelectedCategoryId(null);
                    setFavoritesOnly(false);
                    setSearch('');
                  }}
                  icon={
                    <SymbolView
                      name={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
                      size={16}
                      tintColor={
                        selectedCategoryId == null && !favoritesOnly
                          ? theme.text
                          : theme.textSecondary
                      }
                    />
                  }
                />
                <ButterChip
                  label="Favorites"
                  selected={favoritesOnly}
                  onPress={() => setFavoritesOnly((value) => !value)}
                  icon={
                    <SymbolView
                      name={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }}
                      size={16}
                      tintColor={favoritesOnly ? theme.text : theme.textSecondary}
                    />
                  }
                />
                {visibleCategories.map((category) => {
                  const selected = selectedCategoryId === category.id;
                  return (
                    <ButterChip
                      key={category.id}
                      label={category.name}
                      selected={selected}
                      onPress={() => enterAisle(category.id)}
                      icon={
                        <CategoryIcon
                          name={category.name}
                          size={16}
                          color={selected ? theme.text : theme.textSecondary}
                        />
                      }
                    />
                  );
                })}
                {extraCategories.length > 0 ? (
                  <ButterChip
                    label="More"
                    onPress={() => setMoreCategoriesOpen(true)}
                    icon={
                      <SymbolView
                        name={{ ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }}
                        size={16}
                        tintColor={theme.textSecondary}
                      />
                    }
                  />
                ) : null}
                {selectedStore ? (
                  <ButterChip
                    label={`${selectedStore.name} ×`}
                    selected
                    onPress={() => setSelectedStore(null)}
                    icon={
                      snapOptedIn && selectedStore.accepts_snap ? <SnapBadge size="sm" /> : undefined
                    }
                  />
                ) : null}
                {activeFilterChips.map((chip) => (
                  <ButterChip
                    key={chip.key}
                    label={`${chip.label} ×`}
                    selected
                    onPress={chip.onRemove}
                  />
                ))}
              </ScrollView>

              {sectionedHome &&
              staplesArePersonal &&
              displayStaples.length > 0 &&
              !favoritesOnly &&
              !isSearching &&
              !selectedStore ? (
                <View style={styles.section}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.quietLabel}>
                    Your staples
                  </ThemedText>
                  {renderProductGrid(displayStaples.slice(0, AISLE_PREVIEW_COUNT))}
                </View>
              ) : sectionedHome &&
                displayTrending.length > 0 &&
                !favoritesOnly &&
                !isSearching &&
                !selectedStore ? (
                <View style={styles.section}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.quietLabel}>
                    Trending
                  </ThemedText>
                  {renderProductGrid(
                    displayTrending.slice(0, AISLE_PREVIEW_COUNT).map((row) => row.product),
                  )}
                </View>
              ) : null}

              {!sectionedHome ? (
                <View style={styles.productsHeader}>
                  <View style={styles.sectionTitleRow}>
                    <ThemedText type="smallBold" style={[styles.flex, styles.aisleTitle]}>
                      {selectedStore
                        ? selectedStore.name
                        : isSearching
                          ? `Results for “${searchQuery}”`
                          : favoritesOnly
                            ? 'Favorites'
                            : (focusedAisleName ?? 'Products')}
                    </ThemedText>
                    {focusedAisleName && !isSearching && !favoritesOnly ? (
                      <Pressable
                        onPress={() =>
                          setSort((prev) => (prev === 'cheapest' ? 'default' : 'cheapest'))
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sort === 'cheapest' }}>
                        <ThemedText
                          type="smallBold"
                          style={{
                            color: sort === 'cheapest' ? theme.primaryDark : theme.textSecondary,
                          }}>
                          Cheapest first
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                  {focusedAisleName && !isSearching && !favoritesOnly ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {sort === 'cheapest'
                        ? 'Lowest price first · tap Filters to change'
                        : 'Cheapest nearby · tap Filters to change'}
                    </ThemedText>
                  ) : null}
                  {checkingStores ? (
                    <View style={styles.checkingRow}>
                      <ActivityIndicator size="small" color={theme.secondary} />
                      <ThemedText type="small" themeColor="textSecondary">
                        Checking nearby stores…
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Animated.View>
          }
          ListEmptyComponent={
            <ThemedView style={styles.empty}>
              <ThemedText type="smallBold">Nothing here yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {checkingStores
                  ? 'Looking up products at nearby stores…'
                  : selectedStore
                    ? `${selectedStore.name} has no matching items in stock.`
                    : favoritesOnly && !isSearching
                      ? 'Tap the heart on a product to save favorites here.'
                      : isSearching
                        ? 'Try another search, clear filters, or pick a category.'
                        : 'Pull to refresh — or search for something you love.'}
              </ThemedText>
            </ThemedView>
          }
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              const section = item.section;
              const preview = section.products.slice(0, AISLE_PREVIEW_COUNT);
              return (
                <View style={styles.categorySection}>
                  <View style={styles.sectionTitleRow}>
                    <Pressable
                      onPress={() => enterAisle(section.category.id)}
                      style={styles.flex}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${section.category.name} aisle`}>
                      <ThemedText type="smallBold" style={styles.aisleTitle}>
                        {section.category.name}
                      </ThemedText>
                    </Pressable>
                    <Pressable onPress={() => enterAisle(section.category.id)} hitSlop={8}>
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        See all
                      </ThemedText>
                    </Pressable>
                  </View>
                  {renderProductGrid(preview)}
                </View>
              );
            }

            return (
              <View style={styles.gridRow}>
                {item.products.map((product, index) => renderProductCard(product, index))}
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
            nearbyStores={nearbyStores}
            selectedStoreId={selectedStore?.id ?? null}
            showSnapBadges={snapOptedIn}
            onSelectStore={(store) => setSelectedStore(store)}
            onClose={() => setFiltersOpen(false)}
            onResetToPreferences={() => preferenceRules}
            onApply={({ rules, sort: nextSort, onSaleOnly: nextSale }) => {
              setSessionRules(rules);
              setSort(nextSort);
              setOnSaleOnly(nextSale);
              setFiltersOpen(false);
              if (isGuest) {
                saveGuestOnboardingDraft({
                  ...getGuestOnboardingDraft(),
                  foodRules: rules,
                });
                setPreferenceRules(rules);
              }
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
            onRequestAuth={(mode) => {
              setProfileOpen(false);
              requestSignIn(mode);
            }}
            onSignOut={async () => {
              setProfileOpen(false);
              await signOut();
            }}
            onAvatarChanged={(path) => {
              setAvatarPath(path);
              setAvatarVersion(Date.now());
            }}
          />
        ) : null}

        <ProductPeek
          product={peekProduct}
          visible={peekProduct != null}
          saleBadge={
            peekProduct && promotions.has(peekProduct.id)
              ? formatPromotionBadge(promotions.get(peekProduct.id)!)
              : null
          }
          priceCents={
            peekProduct
              ? (shelfPrices.get(peekProduct.id) ?? trendingPrices.get(peekProduct.id) ?? null)
              : null
          }
          quantityOnList={
            peekProduct ? effectiveQtyMap.get(peekProduct.id)?.quantity : undefined
          }
          onClose={closePeek}
          onOpenFull={openFullFromPeek}
          onAdd={() => peekProduct && void handleAdd(peekProduct)}
          onIncrement={() => peekProduct && void handleIncrement(peekProduct)}
          onDecrement={() => peekProduct && void handleDecrement(peekProduct)}
        />

        <ProductDetailSheet
          ref={productSheetRef}
          product={selectedProduct}
          saleBadge={
            selectedProduct && promotions.has(selectedProduct.id)
              ? formatPromotionBadge(promotions.get(selectedProduct.id)!)
              : null
          }
          promotion={
            selectedProduct && promotions.has(selectedProduct.id)
              ? promotions.get(selectedProduct.id)!
              : null
          }
          preferenceRules={sessionRules}
          snapEligible={
            selectedProduct
              ? categoryIsSnapEligible(categoryById.get(selectedProduct.category_id ?? ''))
              : false
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
          <View
            style={[
              styles.moreSheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.borderInk,
              },
            ]}>
            <View style={[styles.moreHandle, { backgroundColor: theme.primary }]} />
            <ThemedText type="smallBold" style={styles.moreTitle}>
              More categories
            </ThemedText>
            <ScrollView>
              {extraCategories.map((category) => {
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => {
                      enterAisle(category.id);
                      setMoreCategoriesOpen(false);
                    }}
                    style={[styles.moreRow, { borderBottomColor: theme.border }]}>
                    <CategoryIcon name={category.name} size={20} color={theme.text} />
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
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  brandTitle: {
    fontSize: 28,
    lineHeight: 32,
  },
  aisleTitle: {
    fontSize: Type.section,
    lineHeight: 28,
  },
  quietLabel: {
    fontSize: Type.label,
  },
  flex: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  filterBtn: {
    width: 48,
    height: 48,
  },
  dealsStrip: {
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
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
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
    gap: Spacing.two,
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
    backgroundColor: SheetChrome.scrim,
  },
  moreSheet: {
    maxHeight: '50%',
    borderTopLeftRadius: SheetChrome.topRadius,
    borderTopRightRadius: SheetChrome.topRadius,
    borderTopWidth: 2,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  moreHandle: {
    alignSelf: 'center',
    width: SheetChrome.handleWidth,
    height: SheetChrome.handleHeight,
    borderRadius: 2,
    marginBottom: Spacing.two,
  },
  moreTitle: {
    fontSize: Type.section,
    marginBottom: Spacing.one,
  },
  moreRow: {
    paddingVertical: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
