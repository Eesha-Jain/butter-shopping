import { BottomSheet, Column, Host, Text as UIText } from '@expo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import {
  fetchNearbyShops,
  resolveSearchCoords,
  type NearbyStore,
  type SearchCoords,
} from '@/backend';
import { SnapBadge } from '@/components/shop/snap-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { Fonts, Radius, Spacing } from '@/constants/theme';
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

export default function NearbyScreen() {
  const theme = useTheme();
  const snapOptedIn = useSnapOptedIn();
  const mapRef = useRef<MapView>(null);
  const [origin, setOrigin] = useState<SearchCoords | null>(null);
  const [shops, setShops] = useState<NearbyStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selected, setSelected] = useState<NearbyStore | null>(null);
  const [latitudeDelta, setLatitudeDelta] = useState(SEARCH_DELTA);
  const showNames = latitudeDelta <= LABEL_ZOOM_DELTA;

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
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={origin != null}
        showsMyLocationButton={false}
        onRegionChangeComplete={(next) => setLatitudeDelta(next.latitudeDelta)}>
        {origin ? (
          <Circle
            center={origin}
            radius={RADIUS_METERS}
            strokeColor={theme.primary}
            strokeWidth={2}
            fillColor={`${theme.primary}22`}
          />
        ) : null}
        {pins.map((shop) => (
          <Marker
            key={shop.id}
            coordinate={{
              latitude: shop.latitude as number,
              longitude: shop.longitude as number,
            }}
            title={shop.name}
            anchor={{ x: 0.5, y: 0 }}
            tracksViewChanges={showNames}
            onPress={() => setSelected(shop)}>
            <View style={styles.pin} pointerEvents="none">
              <View style={[styles.pinDot, { backgroundColor: theme.primary, borderColor: theme.background }]} />
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
            <ButterButton label="Try again" variant="yellow" onPress={() => void loadShops()} />
          ) : null}
        </ThemedView>
      ) : null}

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

      <Host style={styles.sheetHost}>
        <BottomSheet
          isPresented={selected != null}
          onDismiss={() => setSelected(null)}>
          <Column>
            <UIText>
              {`${selected?.name ?? ''}${snapOptedIn && selected?.accepts_snap ? ' · SNAP' : ''}`}
            </UIText>
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
    borderRadius: Radius.card,
    gap: Spacing.two,
    alignItems: 'center',
  },
  retry: {
    position: 'absolute',
    bottom: Spacing.six,
    alignSelf: 'center',
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
