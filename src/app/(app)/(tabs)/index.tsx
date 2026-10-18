import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveList } from '@/auth/active-list';
import { useAppProfile } from '@/auth/app-profile';
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
  getStorePriceCentsForStores,
  type OpenPricesGeo,
  getEffectiveGroceryCashbackBps,
  getGuestFavoriteIds,
  getGuestFoodRules,
  getGuestOnboardingDraft,
  getMyProfile,
  publicImageUrl,
  saveGuestOnboardingDraft,
  getProductPromotionMap,
  getProductTraitsForIds,
  getProductsByIds,
  indexTraitsByProduct,
  listCampusPopularProducts,
  listFoodTraits,
  listMyFavoriteProductIds,
  listMyFoodRules,
  listMyLocations,
  listMyStapleProductIds,
  listShelfForStores,
  listTrending,
  removeListItem,
  resolveSearchCoords,
  resolveShopZip,
  rulesFromUserFoodRules,
  setGuestFavorite,
  setProductFavorite,
  showAddedToast,
  showErrorToast,
  showSuccessToast,
  updateListItem,
  type CategoryProductSection,
  type FoodTrait,
  type NearbyStore,
  type Product,
  type ProductCategory,
  type ProductTrait,
  type Promotion,
  type SessionFoodRule,
  type ShopSort,
  type UserLocation,
} from '@/backend';
import { AppHeader } from '@/components/app/app-header';
import { CategoryIcon } from '@/components/shop/category-icons';
import { MiniCow } from '@/components/shop/mini-cow';
import { ProductPeek } from '@/components/shop/product-peek';
import type { ProductPeekAnchor } from '@/components/shop/product-peek-layout';
import { ShopFiltersDrawer } from '@/components/shop/shop-filters-drawer';
import {
  ShopGridRow,
  ShopProductStrip,
  ShopSectionRow,
  ShopSkeletonRow,
  type ShopCardState,
  type StripItem,
} from '@/components/shop/shop-list-rows';
import type { ShopCardActions } from '@/components/shop/shop-product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StoreLogo } from '@/components/plan/store-logo';
import { ButterChip } from '@/components/ui/butter-chip';
import { ButterSearchField } from '@/components/ui/butter-search-field';
import { NativeIconButton } from '@/components/ui/native-icon-button';
import { BottomTabInset, Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  describeSelection,
  groupStores,
  matchStoresForQuery,
  toggleGroupIds,
} from '@/utils/store-names';
import {
  scheduleProductDetailPrefetch,
  setProductPrefetchPaused,
} from '@/services/product-detail-prefetch';
import {
  browseCategories,
  buildHomeSections,
  fetchShopCatalog,
  mergeProducts,
  productMatchesSearch,
  productsInAisle,
  readShopCatalogCache,
  searchCatalog,
  catalogSignature,
  writeShopCatalogCache,
  writeShopExtrasCache,
  type ShopCatalog,
} from '@/services/shop-catalog';

const PENDING_ITEM_ID = '__pending__';

const VISIBLE_CATEGORIES = 8;

type ShopListItem =
  | { kind: 'section'; section: CategoryProductSection }
  | { kind: 'row'; products: Product[] }
  | { kind: 'skeleton'; key: string };

type ShopListVariant = 'home' | 'browse';

const SKELETON_ROWS: ShopListItem[] = Array.from({ length: 4 }, (_, i) => ({
  kind: 'skeleton' as const,
  key: `skeleton-${i}`,
}));
/** Rows past the last visible one whose prices are fetched ahead of scrolling. */
const PRICE_LOOKAHEAD_ROWS = 8;
/** Products priced up front when a list opens (before viewability reports anything). */
const PRICE_INITIAL_COUNT = 24;

function chunkProducts(products: Product[], size = 2): Product[][] {
  const rows: Product[][] = [];
  for (let i = 0; i < products.length; i += size) {
    rows.push(products.slice(i, i + size));
  }
  return rows;
}

/** Store-filtered shelf: rows plus that store's (gross) shelf prices. */
type StoreShelf = { products: Product[]; priceMap: Map<string, number> };

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_CATEGORIES: ProductCategory[] = [];
const EMPTY_TRAITS: ProductTrait[] = [];
const EMPTY_PRICES = new Map<string, number>();
const PRICE_BATCH = 60;
const CACHE_WRITE_DELAY_MS = 2500;

const AISLE_PREVIEW_COUNT = 10;
const SCROLL_TOP_THRESHOLD = 360;

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
  const { isGuest, requestSignIn } = useSession();
  const { headerName, avatarPath, avatarVersion, openProfile, closeProfile, refreshProfile } =
    useAppProfile();
  const avatarBaseUrl = publicImageUrl('avatars', avatarPath);
  const avatarUrl = avatarBaseUrl ? `${avatarBaseUrl}?t=${avatarVersion}` : null;
  const {
    targets: listTargets,
    activeTarget,
    setActiveTarget,
    refreshTargets,
  } = useActiveList();
  const guestCart = useGuestCart();
  const homeListRef = useRef<FlatList<ShopListItem>>(null);
  const browseListRef = useRef<FlatList<ShopListItem>>(null);
  const scrollYRef = useRef<Record<ShopListVariant, number>>({ home: 0, browse: 0 });
  const showScrollTopRef = useRef(false);
  const searchStickyAtRef = useRef(Infinity);
  const searchPinnedRef = useRef(false);
  const [searchPinned, setSearchPinned] = useState(false);
  const pinProgress = useSharedValue(0);
  const pinnedSearchStyle = useAnimatedStyle(() => ({
    opacity: pinProgress.value,
  }));
  const seededPrefsRef = useRef(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);

  const [initialCache] = useState(readShopCatalogCache);
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [searchLocationLabel, setSearchLocationLabel] = useState<string | null>(null);
  const [qtyMap, setQtyMap] = useState<Map<string, { listItemId: string; quantity: number }>>(
    new Map(),
  );

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [moreCategoriesOpen, setMoreCategoriesOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());

  const [staples, setStaples] = useState<Product[]>([]);
  const [staplesArePersonal, setStaplesArePersonal] = useState(false);
  const [trending, setTrending] = useState<{ product: Product; sponsored: boolean }[]>(
    () => initialCache?.trending ?? [],
  );
  const [catalog, setCatalog] = useState<ShopCatalog | null>(() =>
    initialCache
      ? {
          products: initialCache.products,
          traits: initialCache.traits,
          allCategories: initialCache.allCategories,
        }
      : null,
  );
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [rawPrices, setRawPrices] = useState<Map<string, number>>(
    () => new Map(initialCache?.prices ?? []),
  );
  const pricedIdsRef = useRef(new Set<string>());
  const pricesInFlightRef = useRef(new Set<string>());
  const favoriteLookupsRef = useRef(new Set<string>());
  const catalogDirtyRef = useRef(false);
  const extrasDirtyRef = useRef(false);
  const catalogSigRef = useRef<string | null>(null);
  const [storeShelves, setStoreShelves] = useState<Map<string, StoreShelf>>(() => new Map());
  const storeShelvesRef = useRef(storeShelves);
  const storeFetchesRef = useRef(new Set<string>());
  const geoPromiseRef = useRef<Promise<OpenPricesGeo | null> | null>(null);
  const [dataNonce, setDataNonce] = useState(0);
  const [promotions, setPromotions] = useState<Map<string, Promotion>>(new Map());
  const [checkingStores, setCheckingStores] = useState(false);
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const storeGroups = useMemo(() => groupStores(nearbyStores), [nearbyStores]);
  const selectedStoreLabel = useMemo(
    () => describeSelection(storeGroups, selectedStoreIds).join(', '),
    [storeGroups, selectedStoreIds],
  );
  const selectedStoreGroups = useMemo(() => {
    const selected = new Set(selectedStoreIds);
    return storeGroups.filter((group) => group.ids.some((id) => selected.has(id)));
  }, [storeGroups, selectedStoreIds]);
  const hasStoreFilter = selectedStoreIds.length > 0;
  const selectedStoreKey = selectedStoreIds.join(',');
  const [cashbackBps, setCashbackBps] = useState<number | null>(null);

  const [traits, setTraits] = useState<FoodTrait[]>([]);
  const [preferenceRules, setPreferenceRules] = useState<SessionFoodRule[]>([]);
  const [sessionRules, setSessionRules] = useState<SessionFoodRule[]>([]);
  const [sort, setSort] = useState<ShopSort>('default');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shellReady, setShellReady] = useState(false);

  const [search, setSearch] = useState('');
  const [peekProduct, setPeekProduct] = useState<Product | null>(null);
  const [peekAnchor, setPeekAnchor] = useState<ProductPeekAnchor | null>(null);
  const [peekCompact, setPeekCompact] = useState(false);
  const [peekClosing, setPeekClosing] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const searchQuery = search.trim();
  const isSearching = searchQuery.length > 0;
  const locationSuggestions = useMemo(
    () =>
      isSearching ? groupStores(matchStoresForQuery(searchQuery, nearbyStores)).slice(0, 6) : [],
    [isSearching, nearbyStores, searchQuery],
  );

  const traitsById = useMemo(() => new Map(traits.map((trait) => [trait.id, trait])), [traits]);

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
      let savedLocation: UserLocation | null = null;
      try {
        const foodTraits = await listFoodTraits().catch(() => null);
        if (foodTraits) setTraits(foodTraits);

        if (isGuest) {
          setLocation(null);
          await refreshProfile().catch(() => undefined);
          const guestPrefs = getGuestFoodRules();
          setPreferenceRules(guestPrefs);
          if (!seededPrefsRef.current || refresh) {
            setSessionRules(guestPrefs);
            seededPrefsRef.current = true;
          }
        } else {
          const [locations, foodRules] = await Promise.all([
            listMyLocations().catch(() => [] as UserLocation[]),
            listMyFoodRules().catch(() => null),
          ]);
          await Promise.all([
            refreshTargets().catch(() => undefined),
            refreshProfile().catch(() => undefined),
          ]);
          savedLocation = locations.find((row) => row.is_default) ?? locations[0] ?? null;
          setLocation(savedLocation);
          if (foodRules) {
            const prefs = rulesFromUserFoodRules(foodRules);
            setPreferenceRules(prefs);
            if (!seededPrefsRef.current || refresh) {
              setSessionRules(prefs);
              seededPrefsRef.current = true;
            }
          }
        }
        // Store chips are optional; don't hold products behind the nearby lookup.
        void resolveSearchCoords()
          .then(async (origin) => {
            let label =
              origin &&
              savedLocation?.latitude === origin.latitude &&
              savedLocation.longitude === origin.longitude
                ? formatLocation(savedLocation)
                : null;

            if (!label && origin) {
              const [place] = await Location.reverseGeocodeAsync(origin).catch(() => []);
              const parts = [
                place?.city ?? place?.subregion,
                place?.region,
                place?.postalCode,
              ].filter(Boolean);
              label = parts.length ? parts.join(', ') : null;
            }

            setSearchLocationLabel(label);
            setNearbyStores(await fetchNearbyShops(origin));
          })
          .catch(() => setNearbyStores([]));
      } catch (err) {
        showErrorToast(err, 'Could not load the shop.');
      } finally {
        // Never block the shop on a failed shell request; products load on their own.
        setShellReady(true);
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isGuest, refreshProfile, refreshTargets],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadShell();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadShell]);

  useFocusEffect(
    useCallback(() => {
      if (isGuest || !activeTarget) return;
      void refreshQtyMap(activeTarget.list.id).catch((err: unknown) => {
        showErrorToast(err, 'Could not refresh list quantities.');
      });
    }, [activeTarget, isGuest, refreshQtyMap]),
  );

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

  const getOpenPricesGeo = useCallback(() => {
    geoPromiseRef.current ??= resolveSearchCoords()
      .then((coords) =>
        coords != null
          ? { latitude: coords.latitude, longitude: coords.longitude, radiusKm: 80 }
          : null,
      )
      .catch(() => null);
    return geoPromiseRef.current;
  }, []);

  // Whole catalog lives on-device; every browse view below is a local filter of it.
  useEffect(() => {
    let cancelled = false;
    void fetchShopCatalog()
      .then((next) => {
        if (cancelled) return;
        // Unchanged server data: keep the current object so nothing re-renders or re-saves.
        if (catalogSigRef.current === catalogSignature(next)) return;
        catalogDirtyRef.current = true;
        setCatalog(next);
      })
      .catch((err) => {
        if (!cancelled && !initialCache) showErrorToast(err, 'Could not load products.');
      })
      .finally(() => {
        if (!cancelled) setCatalogSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dataNonce, initialCache]);

  /** Fetches cheapest prices only for ids not priced yet this session (cached values show meanwhile). */
  const ensurePrices = useCallback(
    (ids: string[]) => {
      const missing = [...new Set(ids)].filter(
        (id) => !pricedIdsRef.current.has(id) && !pricesInFlightRef.current.has(id),
      );
      if (missing.length === 0) return;
      for (const id of missing) pricesInFlightRef.current.add(id);
      for (let i = 0; i < missing.length; i += PRICE_BATCH) {
        const batch = missing.slice(i, i + PRICE_BATCH);
        void (async () => {
          try {
            const geo = await getOpenPricesGeo();
            const map = await getCheapestPriceCentsByProductIds(batch, geo);
            for (const id of batch) pricedIdsRef.current.add(id);
            extrasDirtyRef.current = true;
            setRawPrices((prev) => {
              const next = new Map(prev);
              for (const id of batch) {
                const cents = map.get(id);
                if (cents == null) next.delete(id);
                else next.set(id, cents);
              }
              return next;
            });
          } catch {
            // Best effort — cards show cached / no price.
          } finally {
            for (const id of batch) pricesInFlightRef.current.delete(id);
          }
        })();
      }
    },
    [getOpenPricesGeo],
  );

  // Shared shop context (promos, staples, trending, cashback) — not tied to the view.
  const activeGroupId = activeTarget?.group.id ?? null;
  useEffect(() => {
    if (!shellReady) return;

    let cancelled = false;
    void (async () => {
      try {
        const collegeId = isGuest
          ? null
          : ((await getMyProfile().catch(() => null))?.college_id ?? null);

        const [promoMap, stapleProductIds, trendingRows, popularCampus, nextCashbackBps] =
          await Promise.all([
            getProductPromotionMap().catch(() => new Map<string, Promotion>()),
            activeGroupId
              ? listMyStapleProductIds(activeGroupId).catch(() => [] as string[])
              : Promise.resolve([] as string[]),
            listTrending(collegeId).catch(() => []),
            listCampusPopularProducts({ limit: 12 }).catch(() => [] as Product[]),
            getEffectiveGroceryCashbackBps(isGuest).catch(() => null),
          ]);
        if (cancelled) return;

        setPromotions(promoMap);
        setCashbackBps(nextCashbackBps);

        // Personal staples only — campus popular folds into Trending below.
        if (stapleProductIds.length > 0) {
          const stapleProducts = await getProductsByIds(stapleProductIds).catch(() => []);
          if (cancelled) return;
          setStaples(stapleProducts);
          setStaplesArePersonal(true);
        } else {
          setStaples([]);
          setStaplesArePersonal(false);
        }

        const trendingProductIds = trendingRows
          .filter((row) => row.kind === 'product' && row.product_id)
          .map((row) => row.product_id as string);
        const trendingProducts = await getProductsByIds(trendingProductIds).catch(
          () => [] as Product[],
        );
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
        if (mergedTrending.length > 0) {
          extrasDirtyRef.current = true;
          setTrending(mergedTrending);
        }
        ensurePrices([...stapleProductIds, ...mergedTrending.map((row) => row.product.id)]);
      } catch (err) {
        if (!cancelled && !initialCache) showErrorToast(err, 'Could not update products.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeGroupId, dataNonce, ensurePrices, initialCache, isGuest, shellReady]);

  const catalogProducts = catalog?.products ?? EMPTY_PRODUCTS;
  const allCategories = catalog?.allCategories ?? EMPTY_CATEGORIES;
  const categories = useMemo(() => browseCategories(allCategories), [allCategories]);
  const catalogById = useMemo(
    () => new Map(catalogProducts.map((row) => [row.id, row])),
    [catalogProducts],
  );
  const catalogTraits = catalog?.traits ?? EMPTY_TRAITS;
  const traitsByProduct = useMemo(() => indexTraitsByProduct(catalogTraits), [catalogTraits]);

  // Favorites that aren't in the local catalog yet (e.g. added from a remote search).
  useEffect(() => {
    if (!favoritesOnly || !catalog) return;
    const missing = [...favoriteIds].filter(
      (id) => !catalogById.has(id) && !favoriteLookupsRef.current.has(id),
    );
    if (missing.length === 0) return;
    for (const id of missing) favoriteLookupsRef.current.add(id);
    void getProductsByIds(missing)
      .then((rows) => {
        if (rows.length === 0) return;
        setCatalog((prev) => (prev ? { ...prev, products: mergeProducts(prev.products, rows) } : prev));
      })
      .catch(() => undefined);
  }, [catalog, catalogById, favoriteIds, favoritesOnly]);

  // Store filters need store-specific shelf prices, so those still come from the server (cached per key).
  const storeScopeKey = hasStoreFilter
    ? favoritesOnly
      ? `${dataNonce}|${selectedStoreKey}|fav|${favoriteIdsKey}`
      : `${dataNonce}|${selectedStoreKey}|${selectedCategoryId ?? ''}`
    : null;
  const activeShelf = storeScopeKey ? (storeShelves.get(storeScopeKey) ?? null) : null;

  useEffect(() => {
    if (!storeScopeKey || storeShelvesRef.current.has(storeScopeKey)) return;
    if (storeFetchesRef.current.has(storeScopeKey)) return;
    storeFetchesRef.current.add(storeScopeKey);
    const key = storeScopeKey;
    const storeIds = selectedStoreKey.split(',');
    void (async () => {
      let shelf: StoreShelf = { products: [], priceMap: new Map() };
      try {
        if (favoritesOnly) {
          const favIds = favoriteIdsKey ? favoriteIdsKey.split(',') : [];
          const rows = favIds
            .map((id) => catalogById.get(id))
            .filter((row): row is Product => row != null);
          const priceMap = await getStorePriceCentsForStores(
            storeIds,
            rows.map((row) => row.id),
          );
          shelf = { products: rows.filter((row) => priceMap.has(row.id)), priceMap };
        } else {
          const rows = await listShelfForStores(storeIds, {
            limit: 60,
            categoryId: selectedCategoryId,
          });
          shelf = {
            products: rows.map((row) => row.product),
            priceMap: new Map(rows.map((row) => [row.product.id, row.priceCents])),
          };
        }
      } catch (err) {
        showErrorToast(err, 'Could not check nearby stores.');
      } finally {
        storeFetchesRef.current.delete(key);
        const next = new Map(storeShelvesRef.current);
        next.set(key, shelf);
        storeShelvesRef.current = next;
        setStoreShelves(next);
      }
    })();
  }, [
    catalogById,
    favoriteIdsKey,
    favoritesOnly,
    selectedCategoryId,
    selectedStoreKey,
    storeScopeKey,
  ]);

  const shelfPrices = useMemo(
    () =>
      applyCashbackToPriceMap(
        activeShelf ? new Map([...rawPrices, ...activeShelf.priceMap]) : rawPrices,
        cashbackBps,
      ),
    [activeShelf, cashbackBps, rawPrices],
  );

  const stapleIds = useMemo(() => new Set(staples.map((row) => row.id)), [staples]);
  const promotionProductIds = useMemo(() => new Set(promotions.keys()), [promotions]);

  // Prices only matter to the "cheapest" sort; leaving them out otherwise means price
  // arrivals don't reshuffle (or recompute) every list.
  const filterOptions = useMemo(
    () => ({
      sort,
      stapleIds,
      onSaleOnly,
      promotionProductIds,
      priceCentsByProduct: sort === 'cheapest' ? shelfPrices : EMPTY_PRICES,
    }),
    [onSaleOnly, promotionProductIds, shelfPrices, sort, stapleIds],
  );

  const showHome = !favoritesOnly && selectedCategoryId == null && !hasStoreFilter;

  const homeSectionsRaw = useMemo(
    () => buildHomeSections(catalogProducts, categories, AISLE_PREVIEW_COUNT),
    [catalogProducts, categories],
  );

  const categorySections = useMemo(
    (): CategoryProductSection[] =>
      homeSectionsRaw
        .map((section) => ({
          category: section.category,
          products: applyFoodFilters(section.products, sessionRules, traitsByProduct, filterOptions),
        }))
        .filter((section) => section.products.length > 0),
    [filterOptions, homeSectionsRaw, sessionRules, traitsByProduct],
  );

  const homeSearchResults = useMemo(() => {
    if (!showHome || !isSearching) return EMPTY_PRODUCTS;
    return applyFoodFilters(
      searchCatalog(catalogProducts, searchQuery),
      sessionRules,
      traitsByProduct,
      filterOptions,
    );
  }, [
    catalogProducts,
    filterOptions,
    isSearching,
    searchQuery,
    sessionRules,
    showHome,
    traitsByProduct,
  ]);

  // Unfiltered rows for the aisle / favorites / store view.
  const browseBase = useMemo(() => {
    if (showHome) return EMPTY_PRODUCTS;
    if (hasStoreFilter) return activeShelf?.products ?? EMPTY_PRODUCTS;
    if (favoritesOnly) {
      return [...favoriteIds]
        .map((id) => catalogById.get(id))
        .filter(
          (row): row is Product =>
            row != null && (!selectedCategoryId || row.category_id === selectedCategoryId),
        );
    }
    return productsInAisle(catalogProducts, allCategories, selectedCategoryId!);
  }, [
    activeShelf,
    allCategories,
    catalogById,
    catalogProducts,
    favoriteIds,
    favoritesOnly,
    hasStoreFilter,
    selectedCategoryId,
    showHome,
  ]);

  const browseProducts = useMemo(() => {
    const rows = isSearching
      ? browseBase.filter((row) => productMatchesSearch(row, searchQuery))
      : browseBase;
    return applyFoodFilters(rows, sessionRules, traitsByProduct, filterOptions);
  }, [browseBase, filterOptions, isSearching, searchQuery, sessionRules, traitsByProduct]);

  // Up-front prices for what a view opens on; scrolling prices the rest via viewability.
  // "Cheapest first" needs every price to sort, so it still prices the whole view.
  useEffect(() => {
    if (!catalog) return;
    if (showHome) {
      ensurePrices(
        isSearching
          ? homeSearchResults.slice(0, PRICE_INITIAL_COUNT).map((row) => row.id)
          : homeSectionsRaw
              .slice(0, 3)
              .flatMap((section) => section.products.map((row) => row.id)),
      );
    } else if (!hasStoreFilter) {
      ensurePrices(
        (sort === 'cheapest' ? browseBase : browseBase.slice(0, PRICE_INITIAL_COUNT)).map(
          (row) => row.id,
        ),
      );
    }
  }, [
    browseBase,
    catalog,
    ensurePrices,
    hasStoreFilter,
    homeSearchResults,
    homeSectionsRaw,
    isSearching,
    showHome,
    sort,
  ]);

  const productsLoading = hasStoreFilter ? activeShelf == null : catalog == null && !catalogSettled;

  useEffect(() => {
    catalogSigRef.current = catalog ? catalogSignature(catalog) : null;
  }, [catalog]);

  // Persist so the next launch paints instantly. The big catalog write only happens when the
  // catalog changed; prices go to their own small key (debounced — writes are synchronous).
  useEffect(() => {
    if (!catalog || !catalogDirtyRef.current) return;
    const timer = setTimeout(() => {
      catalogDirtyRef.current = false;
      writeShopCatalogCache(catalog);
    }, CACHE_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [catalog]);

  useEffect(() => {
    if (!extrasDirtyRef.current) return;
    const timer = setTimeout(() => {
      extrasDirtyRef.current = false;
      writeShopExtrasCache(rawPrices, trending);
    }, CACHE_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [rawPrices, trending]);

  const refreshShop = useCallback(() => {
    geoPromiseRef.current = null;
    pricedIdsRef.current = new Set();
    favoriteLookupsRef.current = new Set();
    setDataNonce((n) => n + 1);
    void loadShell(true);
  }, [loadShell]);

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

    const viewRows = showHome ? catalogProducts : browseBase;
    const localMatches = viewRows.filter((row) => productMatchesSearch(row, term));

    // "ballard", "98107", "fred meyer seattle": treat store/location words as a store filter.
    const locationStores = matchStoresForQuery(term, nearbyStores);
    if (locationStores.length > 0 && localMatches.length === 0) {
      const ids = locationStores.map((store) => store.id);
      setSelectedStoreIds(ids);
      setSearch('');
      resetBrowseScroll();
      showSuccessToast('Showing stores', describeSelection(storeGroups, ids).join(', '));
      return;
    }

    searchResultToast(localMatches.length, term);

    if (favoritesOnly || term.length < 2 || localMatches.length >= 3) return;

    setCheckingStores(true);
    try {
      const zip = await resolveShopZip();
      let rawProducts = await ensureCatalogForTerm(term, zip);
      if (selectedCategoryId) {
        rawProducts = rawProducts.filter((row) => row.category_id === selectedCategoryId);
      }
      const shelfKey = storeScopeKey;
      let storePrices: Map<string, number> | null = null;
      if (hasStoreFilter) {
        const prices = await getStorePriceCentsForStores(
          selectedStoreKey.split(','),
          rawProducts.map((row) => row.id),
        );
        storePrices = prices;
        rawProducts = rawProducts.filter((row) => prices.has(row.id));
      }
      const traitsForProducts = await getProductTraitsForIds(rawProducts.map((row) => row.id));

      // New rows join the local catalog, so every view (and later filters) sees them.
      setCatalog((prev) =>
        prev
          ? {
              ...prev,
              products: mergeProducts(prev.products, rawProducts),
              traits: [
                ...prev.traits.filter(
                  (row) => !traitsForProducts.some((next) => next.id === row.id),
                ),
                ...traitsForProducts,
              ],
            }
          : { products: rawProducts, traits: traitsForProducts, allCategories: [] },
      );
      catalogDirtyRef.current = true;
      if (shelfKey && storePrices) {
        const prior = storeShelvesRef.current.get(shelfKey);
        const next = new Map(storeShelvesRef.current);
        next.set(shelfKey, {
          products: mergeProducts(prior?.products ?? [], rawProducts),
          priceMap: new Map([...(prior?.priceMap ?? []), ...storePrices]),
        });
        storeShelvesRef.current = next;
        setStoreShelves(next);
      } else {
        ensurePrices(rawProducts.map((row) => row.id));
      }

      const filtered = applyFoodFilters(
        rawProducts,
        sessionRules,
        indexTraitsByProduct(traitsForProducts),
        filterOptions,
      );
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
    const target = activeTarget;
    if (!isGuest && !target) {
      showErrorToast(new Error('No list selected.'));
      return;
    }
    showAddedToast(product.name);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    try {
      if (isGuest) {
        guestCart.addItem({ productId: product.id, quantity: 1 });
      } else if (target) {
        // Optimistic: show it on the list immediately; the refresh reconciles ids.
        setQtyMap((prev) => {
          const next = new Map(prev);
          next.set(product.id, { listItemId: PENDING_ITEM_ID, quantity: 1 });
          return next;
        });
        await addListItem({ listId: target.list.id, productId: product.id, quantity: 1 });
        await refreshQtyMap(target.list.id);
      }
    } catch (err) {
      if (!isGuest && activeTarget) void refreshQtyMap(activeTarget.list.id).catch(() => {});
      showErrorToast(err, 'Could not add that item.');
    }
  };

  const handleIncrement = async (product: Product) => {
    const entry = effectiveQtyMap.get(product.id);
    if (!entry) {
      await handleAdd(product);
      return;
    }
    if (entry.listItemId === PENDING_ITEM_ID) return;
    const target = activeTarget;
    if (!isGuest && !target) return;
    void hapticSuccess();
    try {
      if (isGuest) {
        guestCart.setQuantity(entry.listItemId, entry.quantity + 1);
      } else if (target) {
        setQtyMap((prev) => {
          const next = new Map(prev);
          next.set(product.id, { ...entry, quantity: entry.quantity + 1 });
          return next;
        });
        await updateListItem(entry.listItemId, { quantity: entry.quantity + 1 });
        await refreshQtyMap(target.list.id);
      }
    } catch (err) {
      if (!isGuest && target) void refreshQtyMap(target.list.id).catch(() => {});
      showErrorToast(err, 'Could not update quantity.');
    }
  };

  const handleDecrement = async (product: Product) => {
    const entry = effectiveQtyMap.get(product.id);
    if (!entry || entry.listItemId === PENDING_ITEM_ID) return;
    try {
      if (isGuest) {
        guestCart.setQuantity(entry.listItemId, entry.quantity - 1);
      } else {
        const target = activeTarget;
        if (!target) return;
        setQtyMap((prev) => {
          const next = new Map(prev);
          if (entry.quantity <= 1) next.delete(product.id);
          else next.set(product.id, { ...entry, quantity: entry.quantity - 1 });
          return next;
        });
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
    closeProfile();
    setFiltersOpen(true);
  }, [closeProfile]);

  const openProfileFromShop = useCallback(() => {
    setFiltersOpen(false);
    openProfile();
  }, [openProfile]);

  // Swipe left opens the profile panel (also accepts a rightward pull from the left edge).
  const leftEdgeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-40, 40])
        .onEnd((event) => {
          if (event.translationX < -48 || event.translationX > 48) {
            runOnJS(openProfileFromShop)();
          }
        }),
    [openProfileFromShop],
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

  // Home (aisle previews / home search) and browse (aisle, favorites, store) are separate
  // lists that both stay mounted, so switching between them never rebuilds the home feed.
  const sectionedHome = showHome && !isSearching;
  const activeList: ShopListVariant = showHome ? 'home' : 'browse';

  const displayTrending = useMemo(() => {
    if (!selectedCategoryId) return trending;
    return trending.filter((row) => row.product.category_id === selectedCategoryId);
  }, [selectedCategoryId, trending]);

  const displayStaples = useMemo(() => {
    if (!selectedCategoryId) return staples;
    return staples.filter((product) => product.category_id === selectedCategoryId);
  }, [selectedCategoryId, staples]);

  const homeListData = useMemo((): ShopListItem[] => {
    if (sectionedHome) {
      return categorySections.map((section) => ({
        kind: 'section' as const,
        section,
      }));
    }
    return chunkProducts(homeSearchResults).map((row) => ({
      kind: 'row' as const,
      products: row,
    }));
  }, [categorySections, homeSearchResults, sectionedHome]);

  const browseListData = useMemo(
    (): ShopListItem[] =>
      chunkProducts(browseProducts).map((row) => ({
        kind: 'row' as const,
        products: row,
      })),
    [browseProducts],
  );

  /*
   * Two-phase view switch: the urgent render flips the header/title and shows gray skeleton
   * rows; the real cards mount in a deferred (interruptible) render right after, so a tap
   * never waits on building a dozen product cards.
   */
  const viewKey = `${selectedCategoryId ?? ''}|${favoritesOnly ? 'fav' : ''}|${storeScopeKey ?? ''}`;
  const deferredViewKey = useDeferredValue(viewKey);
  const deferredBrowseData = useDeferredValue(browseListData);
  const deferredHomeData = useDeferredValue(homeListData);
  const browseData =
    !showHome && (viewKey !== deferredViewKey || productsLoading)
      ? SKELETON_ROWS
      : deferredBrowseData;
  const homeData =
    catalog == null && !catalogSettled && deferredHomeData.length === 0
      ? SKELETON_ROWS
      : deferredHomeData;

  // Price only what's on screen (plus a little ahead) instead of whole 400+ item aisles.
  const listDataRef = useRef<Record<ShopListVariant, ShopListItem[]>>({ home: [], browse: [] });
  useEffect(() => {
    listDataRef.current = { home: homeData, browse: browseData };
  }, [browseData, homeData]);
  const ensurePricesRef = useRef(ensurePrices);
  useEffect(() => {
    ensurePricesRef.current = ensurePrices;
  }, [ensurePrices]);

  const priceVisibleRows = useCallback(
    (variant: ShopListVariant, viewable: ViewToken<ShopListItem>[]) => {
      const indices = viewable
        .map((token) => token.index)
        .filter((index): index is number => index != null);
      if (indices.length === 0) return;
      const rows = listDataRef.current[variant].slice(
        Math.min(...indices),
        Math.max(...indices) + PRICE_LOOKAHEAD_ROWS + 1,
      );
      ensurePricesRef.current(
        rows.flatMap((row) =>
          row.kind === 'row'
            ? row.products.map((product) => product.id)
            : row.kind === 'section'
              ? row.section.products.slice(0, AISLE_PREVIEW_COUNT).map((product) => product.id)
              : [],
        ),
      );
    },
    [],
  );
  // FlatList requires these to keep the same identity for the list's lifetime.
  const onHomeViewableChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ShopListItem>[] }) =>
      priceVisibleRows('home', viewableItems),
    [priceVisibleRows],
  );
  const onBrowseViewableChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ShopListItem>[] }) =>
      priceVisibleRows('browse', viewableItems),
    [priceVisibleRows],
  );

  // Warm popup data in the background: trending → preferred → what's on screen.
  useEffect(() => {
    const normal = !showHome
      ? browseProducts
      : sectionedHome
        ? categorySections.flatMap((section) => section.products.slice(0, AISLE_PREVIEW_COUNT))
        : homeSearchResults;
    const known = new Map<string, Product>();
    for (const row of [...staples, ...normal]) known.set(row.id, row);
    const preferredIds = new Set<string>([...favoriteIds, ...effectiveQtyMap.keys()]);
    const preferred = [
      ...staples,
      ...[...preferredIds]
        .map((id) => known.get(id) ?? catalogById.get(id))
        .filter((row): row is Product => row != null),
    ];
    const zip = location?.postal_code?.trim().slice(0, 5);
    scheduleProductDetailPrefetch({
      trending: displayTrending.map((row) => row.product),
      preferred,
      normal,
      preferenceRules: sessionRules,
      isGuest,
      zip: zip && /^\d{5}$/.test(zip) ? zip : null,
    });
  }, [
    browseProducts,
    catalogById,
    categorySections,
    displayTrending,
    effectiveQtyMap,
    favoriteIds,
    homeSearchResults,
    isGuest,
    location,
    sectionedHome,
    sessionRules,
    showHome,
    staples,
  ]);

  useEffect(() => {
    setProductPrefetchPaused(peekProduct != null);
  }, [peekProduct]);

  useEffect(() => () => setProductPrefetchPaused(false), []);

  const applyScrollY = useCallback(
    (y: number) => {
      const pinned = y > searchStickyAtRef.current;
      if (searchPinnedRef.current !== pinned) {
        searchPinnedRef.current = pinned;
        setSearchPinned(pinned);
      }
      pinProgress.set(Math.min(1, Math.max(0, (y - searchStickyAtRef.current) / 16)));
      const visible = y > SCROLL_TOP_THRESHOLD;
      if (showScrollTopRef.current === visible) return;
      showScrollTopRef.current = visible;
      setShowScrollTop(visible);
    },
    [pinProgress],
  );

  // Pinned search / scroll-to-top follow whichever list is showing.
  useEffect(() => {
    applyScrollY(scrollYRef.current[activeList]);
  }, [activeList, applyScrollY]);

  const scrollListToTop = useCallback(
    (animated: boolean) => {
      const ref = activeList === 'home' ? homeListRef : browseListRef;
      ref.current?.scrollToOffset({ offset: 0, animated });
    },
    [activeList],
  );

  /** New browse views open at the top; home keeps its scroll so Back lands where you were. */
  const resetBrowseScroll = useCallback(() => {
    browseListRef.current?.scrollToOffset({ offset: 0, animated: false });
    scrollYRef.current.browse = 0;
  }, []);

  const tapHaptic = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const enterAisle = (categoryId: string) => {
    if (selectedCategoryId === categoryId && !favoritesOnly && !search.trim()) {
      scrollListToTop(true);
      return;
    }
    tapHaptic();
    resetBrowseScroll();
    setSelectedCategoryId(categoryId);
    setFavoritesOnly(false);
    setSearch('');
  };

  const browseAll = () => {
    if (selectedCategoryId == null && !favoritesOnly && !search.trim()) {
      scrollListToTop(true);
      return;
    }
    tapHaptic();
    setSelectedCategoryId(null);
    setFavoritesOnly(false);
    setSearch('');
  };

  /** Full shop home — aisles, trending, staples (clears aisle / favorites / search / store). */
  const backToShopHome = () => {
    if (sectionedHome) {
      scrollListToTop(true);
      return;
    }
    tapHaptic();
    setSelectedCategoryId(null);
    setFavoritesOnly(false);
    setSearch('');
    setSelectedStoreIds([]);
  };

  const renderSearchRow = () => (
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
        style={[styles.iconBtn, styles.filterBtn, { backgroundColor: theme.secondary }]}
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
  );

  const onHomeScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    scrollYRef.current.home = y;
    if (activeList === 'home') applyScrollY(y);
  };

  const onBrowseScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    scrollYRef.current.browse = y;
    if (activeList === 'browse') applyScrollY(y);
  };

  const openPeek = (
    product: Product,
    anchor: ProductPeekAnchor,
    compact: boolean,
    haptic: boolean,
  ) => {
    if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPeekCompact(compact);
    setPeekClosing(false);
    setPeekAnchor(anchor);
    setPeekProduct(product);
  };

  const closePeek = () => {
    setPeekProduct(null);
    setPeekAnchor(null);
    setPeekCompact(false);
    setPeekClosing(false);
  };

  // Cards get one stable actions object; the ref always points at this render's handlers.
  const cardHandlersRef = useRef({
    openPeek,
    handleToggleFavorite,
    handleAdd,
    handleIncrement,
    handleDecrement,
    enterAisle,
  });
  useEffect(() => {
    cardHandlersRef.current = {
      openPeek,
      handleToggleFavorite,
      handleAdd,
      handleIncrement,
      handleDecrement,
      enterAisle,
    };
  });
  const openAisle = useCallback(
    (categoryId: string) => cardHandlersRef.current.enterAisle(categoryId),
    [],
  );
  const cardActions = useMemo<ShopCardActions>(
    () => ({
      open: (product, anchor, compact, haptic) =>
        cardHandlersRef.current.openPeek(product, anchor, compact, haptic),
      toggleFavorite: (product) => void cardHandlersRef.current.handleToggleFavorite(product.id),
      add: (product) => void cardHandlersRef.current.handleAdd(product),
      increment: (product) => void cardHandlersRef.current.handleIncrement(product),
      decrement: (product) => void cardHandlersRef.current.handleDecrement(product),
    }),
    [],
  );

  const cardState = useMemo<ShopCardState>(
    () => ({
      actions: cardActions,
      promotions,
      prices: shelfPrices,
      cashbackActive: cashbackBps != null && cashbackBps > 0,
      qtyMap: effectiveQtyMap,
      favoriteIds,
      peekSourceId: peekProduct && !peekClosing ? peekProduct.id : null,
    }),
    [
      cardActions,
      cashbackBps,
      effectiveQtyMap,
      favoriteIds,
      peekClosing,
      peekProduct,
      promotions,
      shelfPrices,
    ],
  );

  const stapleItems = useMemo(
    (): StripItem[] =>
      displayStaples.slice(0, AISLE_PREVIEW_COUNT).map((product) => ({ product })),
    [displayStaples],
  );

  const trendingItems = useMemo(
    (): StripItem[] =>
      displayTrending.slice(0, AISLE_PREVIEW_COUNT).map((row) => ({
        product: row.product,
        metaLabel: row.sponsored ? 'Sponsored' : 'Popular',
      })),
    [displayTrending],
  );

  const focusedAisleName = selectedCategoryId
    ? (allCategories.find((row) => row.id === selectedCategoryId)?.name ?? 'Aisle')
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

  const renderShopList = (variant: ShopListVariant) => {
    const hidden = variant !== activeList;
    return (
      <FlatList
          ref={variant === 'home' ? homeListRef : browseListRef}
          data={variant === 'home' ? homeData : browseData}
          keyExtractor={(item) =>
            item.kind === 'section'
              ? item.section.category.id
              : item.kind === 'skeleton'
                ? item.key
                : item.products.map((product) => product.id).join('-') || 'empty'
          }
          onViewableItemsChanged={
            variant === 'home' ? onHomeViewableChanged : onBrowseViewableChanged
          }
          contentInsetAdjustmentBehavior="never"
          style={[styles.shopList, hidden && styles.hiddenList]}
          pointerEvents={hidden ? 'none' : 'auto'}
          accessibilityElementsHidden={hidden}
          importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
          initialNumToRender={variant === 'home' ? 3 : 6}
          maxToRenderPerBatch={variant === 'home' ? 3 : 6}
          windowSize={variant === 'home' ? 7 : 9}
          removeClippedSubviews={false}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: insets.top + Spacing.two,
              paddingBottom: BottomTabInset + insets.bottom + Spacing.four,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          onScroll={variant === 'home' ? onHomeScroll : onBrowseScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refreshShop}
              tintColor={theme.text}
            />
          }
          ListHeaderComponentStyle={styles.listHeaderLayer}
          ListHeaderComponent={
            <View style={styles.header}>
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
                    Find your groceries here
                  </ThemedText>
                  {searchLocationLabel ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {searchLocationLabel}
                    </ThemedText>
                  ) : null}
                </View>
              </View>

              <View
                onLayout={(e) => {
                  searchStickyAtRef.current = e.nativeEvent.layout.y;
                }}>
                {renderSearchRow()}
              </View>

              {locationSuggestions.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.chipRow}>
                  {locationSuggestions.map((group) => (
                    <ButterChip
                      key={group.key}
                      label={
                        group.stores.length === 1 && group.stores[0]?.city
                          ? `${group.name} · ${group.stores[0].city}`
                          : `${group.name} (${group.stores.length})`
                      }
                      onPress={() => {
                        setSelectedStoreIds(group.ids);
                        setSearch('');
                        resetBrowseScroll();
                      }}
                    />
                  ))}
                </ScrollView>
              ) : null}

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
                  onPress={browseAll}
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
                  onPress={() => {
                    const next = !favoritesOnly;
                    tapHaptic();
                    if (next) resetBrowseScroll();
                    setFavoritesOnly(next);
                    if (next) setSelectedCategoryId(null);
                  }}
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
                {selectedStoreGroups.map((group) => (
                  <ButterChip
                    key={`store:${group.key}`}
                    label={`${group.name} ×`}
                    selected
                    icon={<StoreLogo storeName={group.name} size={20} />}
                    onPress={() =>
                      setSelectedStoreIds((ids) => ids.filter((id) => !group.ids.includes(id)))
                    }
                  />
                ))}
                {activeFilterChips.map((chip) => (
                  <ButterChip
                    key={chip.key}
                    label={`${chip.label} ×`}
                    selected
                    onPress={chip.onRemove}
                  />
                ))}
              </ScrollView>

              {variant === 'home' &&
              sectionedHome &&
              staplesArePersonal &&
              displayStaples.length > 0 &&
              !favoritesOnly &&
              !isSearching &&
              !hasStoreFilter ? (
                <View style={styles.section}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.quietLabel}>
                    Your staples
                  </ThemedText>
                  <ShopProductStrip items={stapleItems} state={cardState} />
                </View>
              ) : variant === 'home' &&
                sectionedHome &&
                displayTrending.length > 0 &&
                !favoritesOnly &&
                !isSearching &&
                !hasStoreFilter ? (
                <View
                  style={[
                    styles.trendingBanner,
                    {
                      backgroundColor: theme.primary,
                      borderColor: theme.borderInk,
                    },
                  ]}>
                  <View style={styles.trendingHeader}>
                    <View style={styles.trendingTitleRow}>
                      <MiniCow flipped />
                      <ThemedText type="smallBold" style={styles.trendingTitle}>
                        Trending
                      </ThemedText>
                      <MiniCow />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      Popular on campus · Sponsored labeled
                    </ThemedText>
                  </View>
                  <ShopProductStrip
                    items={trendingItems}
                    state={cardState}
                    // Cream stick on gold banner ? same yellow vanishes and reads as a dark blob.
                    butterColor={theme.backgroundElement}
                  />
                </View>
              ) : null}

              {!sectionedHome ? (
                <View style={styles.productsHeader}>
                  <View style={styles.sectionTitleRow}>
                    <NativeIconButton
                      accessibilityLabel="Back to shop home"
                      tooltipAlign="left"
                      iosSymbol="chevron.left"
                      androidSymbol="arrow_back"
                      onPress={backToShopHome}
                      style={styles.backBtn}
                    />
                    <ThemedText type="smallBold" style={[styles.flex, styles.aisleTitle]}>
                      {hasStoreFilter
                        ? selectedStoreLabel
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
            </View>
          }
          ListEmptyComponent={
            productsLoading || !shellReady ? (
              <ThemedView style={styles.empty}>
                <ActivityIndicator color={theme.text} />
                <ThemedText type="small" themeColor="textSecondary">
                  Loading products…
                </ThemedText>
              </ThemedView>
            ) : (
            <ThemedView style={styles.empty}>
              <ThemedText type="smallBold">Nothing here yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {checkingStores
                  ? 'Looking up products at nearby stores…'
                  : hasStoreFilter
                    ? `${selectedStoreLabel} has no matching items in stock.`
                    : favoritesOnly && !isSearching
                      ? 'Tap the heart on a product to save favorites here.'
                      : isSearching
                        ? 'Try another search, clear filters, or pick a category.'
                        : 'Pull to refresh — or search for something you love.'}
              </ThemedText>
            </ThemedView>
            )
          }
          renderItem={({ item }) =>
            item.kind === 'section' ? (
              <ShopSectionRow
                section={item.section}
                previewCount={AISLE_PREVIEW_COUNT}
                state={cardState}
                onOpenAisle={openAisle}
              />
            ) : item.kind === 'skeleton' ? (
              <ShopSkeletonRow />
            ) : (
              <ShopGridRow products={item.products} state={cardState} />
            )
          }
        />
    );
  };

  if (isLoading && !shellReady && !initialCache) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="small" themeColor="textSecondary">
          Loading shop
        </ThemedText>
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
      <View style={styles.listWrap}>
        {renderShopList('home')}
        {renderShopList('browse')}
      </View>

      <Animated.View
        pointerEvents={searchPinned ? 'auto' : 'none'}
        style={[
          styles.pinnedSearch,
          pinnedSearchStyle,
          {
            paddingTop: insets.top + Spacing.two,
            backgroundColor: theme.background,
            borderBottomColor: theme.border,
          },
        ]}>
        {renderSearchRow()}
      </Animated.View>

      {showScrollTop ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          style={[
            styles.scrollTopFabWrap,
            { bottom: BottomTabInset + insets.bottom - Spacing.three, right: Spacing.three },
          ]}>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              scrollListToTop(true);
            }}
            style={[styles.scrollTopFab, { backgroundColor: theme.secondary }]}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top"
            hitSlop={8}>
            <SymbolView
              name={
                {
                  ios: 'chevron.up',
                  android: 'keyboard_arrow_up',
                  web: 'keyboard_arrow_up',
                } as ComponentProps<typeof SymbolView>['name']
              }
              size={22}
              tintColor={theme.primary}
            />
          </Pressable>
        </Animated.View>
      ) : null}

        {filtersOpen ? (
          <ShopFiltersDrawer
            key="shop-filters"
            visible
            traits={traits}
            draftRules={sessionRules}
            draftSort={sort}
            draftOnSaleOnly={onSaleOnly}
            storeGroups={storeGroups}
            selectedStoreIds={selectedStoreIds}
            onToggleStoreGroup={(group) =>
              setSelectedStoreIds((prev) => toggleGroupIds(group, prev))
            }
            onClearStores={() => setSelectedStoreIds([])}
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

        <ProductPeek
          product={peekProduct}
          visible={peekProduct != null}
          anchor={peekAnchor}
          compact={peekCompact}
          saleBadge={
            peekProduct && promotions.has(peekProduct.id)
              ? formatPromotionBadge(promotions.get(peekProduct.id)!)
              : null
          }
          promotion={peekProduct ? (promotions.get(peekProduct.id) ?? null) : null}
          preferenceRules={sessionRules}
          quantityOnList={
            peekProduct ? effectiveQtyMap.get(peekProduct.id)?.quantity : undefined
          }
          favorited={peekProduct ? favoriteIds.has(peekProduct.id) : false}
          onToggleFavorite={() => peekProduct && void handleToggleFavorite(peekProduct.id)}
          onClose={closePeek}
          onCloseStart={() => setPeekClosing(true)}
          onAdd={() => peekProduct && void handleAdd(peekProduct)}
          onIncrement={() => peekProduct && void handleIncrement(peekProduct)}
          onDecrement={() => peekProduct && void handleDecrement(peekProduct)}
        />

        {!isGuest && activeTarget ? (
          <Pressable
            onPress={() => setListPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Shopping for ${activeTarget.group.name}. Tap to change list`}
            style={[
              styles.listPill,
              {
                bottom: BottomTabInset + insets.bottom - Spacing.three,
                backgroundColor: theme.primary,
                borderColor: theme.borderInk,
              },
            ]}>
            <SymbolView
              name={{ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }}
              size={16}
              tintColor={theme.text}
            />
            <View style={styles.listPillText}>
              <ThemedText type="small" style={styles.listPillLabel}>
                Shopping for
              </ThemedText>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.listPillName}>
                {activeTarget.group.name}
              </ThemedText>
            </View>
            {listTargets.length > 1 ? (
              <SymbolView
                name={{
                  ios: 'chevron.up.chevron.down',
                  android: 'unfold_more',
                  web: 'unfold_more',
                }}
                size={14}
                tintColor={theme.text}
              />
            ) : null}
          </Pressable>
        ) : null}

        <Modal
          visible={listPickerOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setListPickerOpen(false)}>
          <Pressable style={styles.moreBackdrop} onPress={() => setListPickerOpen(false)} />
          <View
            style={[
              styles.moreSheet,
              { backgroundColor: theme.background, borderColor: theme.borderInk },
            ]}>
            <View style={[styles.moreHandle, { backgroundColor: theme.primary }]} />
            <ThemedText type="smallBold" style={styles.moreTitle}>
              Shop for which list?
            </ThemedText>
            <ScrollView>
              {listTargets.map((target) => {
                const selected = target.list.id === activeTarget?.list.id;
                return (
                  <Pressable
                    key={target.list.id}
                    onPress={() => {
                      setListPickerOpen(false);
                      if (selected) return;
                      setActiveTarget(target);
                      void refreshQtyMap(target.list.id);
                    }}
                    style={[styles.moreRow, { borderBottomColor: theme.border }]}>
                    <View style={styles.flex}>
                      <ThemedText type={selected ? 'smallBold' : 'default'}>
                        {target.group.name}
                      </ThemedText>
                      {listTargets.filter((t) => t.group.id === target.group.id).length > 1 ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {target.list.name}
                        </ThemedText>
                      ) : null}
                    </View>
                    {selected ? (
                      <SymbolView
                        name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                        size={18}
                        tintColor={theme.text}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>

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

function formatLocation(location: UserLocation | null): string | null {
  if (!location) return null;
  if (location.label) return location.label;
  const parts = [location.address_line1, location.city, location.region, location.postal_code].filter(
    Boolean,
  );
  return parts.length ? parts.join(', ') : null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  listPill: {
    position: 'absolute',
    left: Spacing.three,
    maxWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 2,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  listPillText: {
    flexShrink: 1,
  },
  listPillLabel: {
    fontSize: 11,
    lineHeight: 13,
  },
  listPillName: {
    lineHeight: 18,
  },
  listWrap: {
    flex: 1,
  },
  shopList: {
    ...StyleSheet.absoluteFill,
  },
  hiddenList: {
    opacity: 0,
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
    gap: Spacing.four,
  },
  scrollTopFabWrap: {
    position: 'absolute',
    zIndex: 20,
  },
  scrollTopFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    gap: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
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
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  trendingBanner: {
    gap: Spacing.three,
    marginHorizontal: -Spacing.three,
    marginTop: Spacing.two,
    marginBottom: 0,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderTopWidth: 2,
    borderBottomWidth: 2,
  },
  trendingHeader: {
    gap: Spacing.one,
  },
  trendingTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  trendingTitle: {
    fontSize: Type.section,
    lineHeight: 26,
  },
  sectionTitleRow: {
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  listHeaderLayer: {
    zIndex: 10,
  },
  pinnedSearch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 15,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    marginLeft: -Spacing.one,
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
