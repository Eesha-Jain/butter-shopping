import { BottomSheet, Column, Host, Text as UIText } from '@expo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import {
  fetchNearbyShops,
  resolveSearchCoords,
  type NearbyStore,
  type SearchCoords,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SEARCH_DELTA = 0.2;
const FALLBACK_REGION: Region = {
  latitude: 47.6062,
  longitude: -122.3321,
  latitudeDelta: SEARCH_DELTA,
  longitudeDelta: SEARCH_DELTA,
};

export default function NearbyScreen() {
  const theme = useTheme();
  const mapRef = useRef<MapView>(null);
  const [origin, setOrigin] = useState<SearchCoords | null>(null);
  const [shops, setShops] = useState<NearbyStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selected, setSelected] = useState<NearbyStore | null>(null);

  const loadShops = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const coords = await resolveSearchCoords();
      setOrigin(coords);
      const data = await fetchNearbyShops(coords);
      setShops(data);
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
  }, []);

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

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={origin != null}
        showsMyLocationButton={false}>
        {pins.map((shop) => (
          <Marker
            key={shop.id}
            coordinate={{
              latitude: shop.latitude as number,
              longitude: shop.longitude as number,
            }}
            title={shop.name}
            onPress={() => setSelected(shop)}
          />
        ))}
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
            <Pressable onPress={() => void loadShops()}>
              <ThemedText type="linkPrimary">Try again</ThemedText>
            </Pressable>
          ) : null}
        </ThemedView>
      ) : null}

      <Pressable
        onPress={() => void loadShops(true)}
        disabled={isRefreshing || isLoading}
        style={[styles.retry, { backgroundColor: theme.backgroundElement, opacity: isRefreshing ? 0.6 : 1 }]}>
        <ThemedText type="smallBold">{isRefreshing ? 'Updating…' : 'Refresh'}</ThemedText>
      </Pressable>

      <Host style={styles.sheetHost}>
        <BottomSheet
          isPresented={selected != null}
          onDismiss={() => setSelected(null)}>
          <Column>
            <UIText>{selected?.name ?? ''}</UIText>
            {selected?.city ? <UIText>{selected.city}</UIText> : null}
            {selected ? <UIText>{formatDistanceKm(selected.distance_km)}</UIText> : null}
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
    borderRadius: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
  retry: {
    position: 'absolute',
    bottom: Spacing.six,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  sheetHost: {
    position: 'absolute',
  },
});
