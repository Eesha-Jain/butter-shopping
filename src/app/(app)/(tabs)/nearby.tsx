import { BottomSheet, Button, Column, Host, Text as UIText } from '@expo/ui';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import {
  fetchNearbyShops,
  listPreferredStoreIds,
  preferStore,
  resolveSearchCoords,
  saveMyLocation,
  unpreferStore,
  type NearbyStore,
  type SearchCoords,
} from '@/backend';
import { SnapBadge } from '@/components/shop/snap-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { BottomTabInset, Fonts, Radius, Spacing } from '@/constants/theme';
import { useSnapOptedIn } from '@/hooks/use-snap-opted-in';
import { useTheme } from '@/hooks/use-theme';

const SEARCH_DELTA = 0.18;
const RADIUS_METERS = 10_000;
const LABEL_ZOOM_DELTA = 0.05;
const FALLBACK_REGION: Region = {
  latitude: 47.6062,
  longitude: -122.3321,
  latitudeDelta: SEARCH_DELTA,
  longitudeDelta: SEARCH_DELTA,
};

function emptyAddress(coords: SearchCoords) {
  return {
    label: 'Search from here',
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
    latitude: coords.latitude,
    longitude: coords.longitude,
    is_default: true,
  };
}

export default function NearbyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const snapOptedIn = useSnapOptedIn();
  const controlBottom = BottomTabInset + insets.bottom + Spacing.three;
  const { session, isGuest } = useSession();
  const signedIn = Boolean(session) && !isGuest;
  const mapRef = useRef<MapView>(null);
  const [origin, setOrigin] = useState<SearchCoords | null>(null);
  const [followGps, setFollowGps] = useState(false);
  const followGpsRef = useRef(false);
  const [shops, setShops] = useState<NearbyStore[] | null>(null);
  const [preferredIds, setPreferredIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selected, setSelected] = useState<NearbyStore | null>(null);
  const [droppedPin, setDroppedPin] = useState<SearchCoords | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [originBusy, setOriginBusy] = useState(false);
  const [latitudeDelta, setLatitudeDelta] = useState(SEARCH_DELTA);
  const showNames = latitudeDelta <= LABEL_ZOOM_DELTA;
  const sheetOpen = selected != null || droppedPin != null;

  const loadShops = useCallback(
    async (refresh = false, opts?: { followGps?: boolean; origin?: SearchCoords }) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      try {
        const useGps = opts?.followGps ?? followGpsRef.current;
        const coords = opts?.origin ?? (await resolveSearchCoords({ followGps: useGps }));
        setOrigin(coords);
        const [data, ids] = await Promise.all([fetchNearbyShops(coords), listPreferredStoreIds()]);
        setShops(data);
        setPreferredIds(new Set(ids));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load nearby shops.');
        if (!refresh) {
          setShops(null);
          setOrigin(null);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    followGpsRef.current = followGps;
  }, [followGps]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadShops();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadShops]);

  const pins = (shops ?? []).filter(
    (shop) =>
      shop.latitude != null &&
      shop.longitude != null &&
      Number.isFinite(shop.latitude) &&
      Number.isFinite(shop.longitude),
  );

  useEffect(() => {
    const coordinates = [
      ...(origin ? [origin] : []),
      ...(shops ?? [])
        .filter(
          (shop) =>
            shop.latitude != null &&
            shop.longitude != null &&
            Number.isFinite(shop.latitude) &&
            Number.isFinite(shop.longitude),
        )
        .map((shop) => ({
          latitude: shop.latitude as number,
          longitude: shop.longitude as number,
        })),
    ];
    if (coordinates.length === 0) {
      return;
    }
    mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: { top: 72, right: 40, bottom: 72, left: 40 },
      animated: true,
    });
  }, [origin, shops]);

  const region: Region = origin
    ? {
        latitude: origin.latitude,
        longitude: origin.longitude,
        latitudeDelta: SEARCH_DELTA,
        longitudeDelta: SEARCH_DELTA,
      }
    : FALLBACK_REGION;

  const showEmpty = !isLoading && !error && (shops ?? []).length === 0;
  const overlayMessage = error
    ? error
    : isLoading && shops == null
      ? 'Finding shops near you'
      : showEmpty
        ? 'No shops nearby'
        : null;

  async function toggleFavorite(shop: NearbyStore) {
    if (!signedIn) {
      router.push('/login');
      return;
    }
    setFavoriteBusy(true);
    try {
      const favored = preferredIds.has(shop.id);
      if (favored) {
        await unpreferStore(shop.id);
        setPreferredIds((prev) => {
          const next = new Set(prev);
          next.delete(shop.id);
          return next;
        });
      } else {
        await preferStore(shop.id);
        setPreferredIds((prev) => new Set(prev).add(shop.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update favorite store.');
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function searchFromHere(coords: SearchCoords) {
    setOriginBusy(true);
    setError(null);
    try {
      followGpsRef.current = false;
      setFollowGps(false);
      if (signedIn) {
        await saveMyLocation(emptyAddress(coords));
      }
      setDroppedPin(null);
      await loadShops(false, { origin: coords, followGps: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search from here.');
    } finally {
      setOriginBusy(false);
    }
  }

  async function useGps() {
    followGpsRef.current = true;
    setFollowGps(true);
    setDroppedPin(null);
    setSelected(null);
    await loadShops(true, { followGps: true });
  }

  function closeSheet() {
    setSelected(null);
    setDroppedPin(null);
  }

  const selectedFavored = selected != null && preferredIds.has(selected.id);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        onRegionChangeComplete={(next) => setLatitudeDelta(next.latitudeDelta)}
        onLongPress={(event) => {
          setSelected(null);
          setDroppedPin(event.nativeEvent.coordinate);
        }}>
        {origin ? (
          <Circle
            center={origin}
            radius={RADIUS_METERS}
            strokeColor={theme.primary}
            strokeWidth={2}
            fillColor={`${theme.primary}22`}
          />
        ) : null}
        {pins.map((shop) => {
          const favored = preferredIds.has(shop.id);
          return (
            <Marker
              key={shop.id}
              coordinate={{
                latitude: shop.latitude as number,
                longitude: shop.longitude as number,
              }}
              title={shop.name}
              anchor={{ x: 0.5, y: 0 }}
              tracksViewChanges={showNames || favored}
              onPress={() => {
                setDroppedPin(null);
                setSelected(shop);
              }}>
              <View style={styles.pin} pointerEvents="none">
                <View
                  style={[
                    styles.pinDot,
                    {
                      backgroundColor: favored ? theme.savings : theme.primary,
                      borderColor: theme.background,
                    },
                  ]}
                />
                {showNames ? (
                  <View style={styles.pinLabelRow}>
                    <Text
                      style={[styles.pinLabel, { color: theme.text, backgroundColor: theme.background }]}
                      numberOfLines={2}>
                      {shop.name}
                    </Text>
                    {snapOptedIn && shop.accepts_snap ? <SnapBadge size="sm" /> : null}
                  </View>
                ) : null}
              </View>
            </Marker>
          );
        })}
      </MapView>

      {overlayMessage ? (
        <ThemedView type="backgroundElement" style={styles.overlay}>
          {isLoading && shops == null ? <ActivityIndicator color={theme.text} /> : null}
          <ThemedText type={showEmpty ? 'subtitle' : 'small'}>{overlayMessage}</ThemedText>
          {showEmpty ? (
            <ThemedText type="small" themeColor="textSecondary">
              Try a wider area, or check that location is allowed.
            </ThemedText>
          ) : null}
          {error || showEmpty ? (
            <ButterButton label="Try again" variant="yellow" onPress={() => void loadShops()} />
          ) : null}
        </ThemedView>
      ) : null}

      <View style={[styles.controls, { bottom: controlBottom }]} pointerEvents="box-none">
        <Pressable
          onPress={() => void useGps()}
          disabled={isRefreshing || isLoading}
          style={[
            styles.retry,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.borderInk,
              opacity: isRefreshing || followGps ? 0.6 : 1,
            },
          ]}>
          <ThemedText type="smallBold">{followGps ? 'Using GPS' : 'Use GPS'}</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => void loadShops(true)}
          disabled={isRefreshing || isLoading}
          style={[
            styles.retry,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.borderInk,
              opacity: isRefreshing ? 0.6 : 1,
            },
          ]}>
          <ThemedText type="smallBold">{isRefreshing ? 'Updating…' : 'Refresh'}</ThemedText>
        </Pressable>
      </View>

      <Host style={styles.sheetHost} pointerEvents="box-none">
        <BottomSheet isPresented={sheetOpen} onDismiss={closeSheet}>
          <Column>
            {droppedPin ? (
              <>
                <UIText>Search from here?</UIText>
                <UIText>Nearby will look for shops within 10 km of this pin.</UIText>
                {!signedIn ? (
                  <UIText>Sign in to save this pin as your default search origin.</UIText>
                ) : null}
                {!signedIn ? (
                  <Button onPress={() => router.push('/login')}>Sign in</Button>
                ) : null}
                <Button
                  disabled={originBusy}
                  onPress={() => void searchFromHere(droppedPin)}>
                  {originBusy ? 'Searching…' : 'Search from here'}
                </Button>
              </>
            ) : (
              <>
                <UIText>
                  {`${selected?.name ?? ''}${snapOptedIn && selected?.accepts_snap ? ' · SNAP' : ''}`}
                </UIText>
                {selected?.city ? <UIText>{selected.city}</UIText> : null}
                {selected ? <UIText>{formatDistanceKm(selected.distance_km)}</UIText> : null}
                {!signedIn ? <UIText>Sign in to favorite this store.</UIText> : null}
                {selected && signedIn ? (
                  <Button
                    disabled={favoriteBusy}
                    onPress={() => void toggleFavorite(selected)}>
                    {favoriteBusy
                      ? 'Saving…'
                      : selectedFavored
                        ? 'Remove favorite'
                        : 'Favorite store'}
                  </Button>
                ) : selected ? (
                  <Button onPress={() => router.push('/login')}>Sign in to favorite</Button>
                ) : null}
              </>
            )}
          </Column>
        </BottomSheet>
      </Host>
    </View>
  );
}

function formatDistanceKm(distanceKm: number | null) {
  if (distanceKm == null || !Number.isFinite(Number(distanceKm))) {
    return '';
  }
  const km = Number(distanceKm);
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  overlay: {
    position: 'absolute',
    top: Spacing.six,
    left: Spacing.three,
    right: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
    gap: Spacing.two,
    alignItems: 'center',
  },
  controls: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    zIndex: 2,
  },
  retry: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: 2,
  },
  sheetHost: {
    position: 'absolute',
  },
  pin: {
    alignItems: 'center',
    width: 120,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  pinLabelRow: {
    marginTop: 4,
    alignItems: 'center',
    gap: 4,
  },
  pinLabel: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    fontSize: 12,
    fontFamily: Fonts.sansBold,
    textAlign: 'center',
  },
});
