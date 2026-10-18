import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { fetchNearbyShops, type NearbyStore } from '@/backend';
import { SnapBadge } from '@/components/shop/snap-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useSnapOptedIn } from '@/hooks/use-snap-opted-in';
import { useTheme } from '@/hooks/use-theme';

export default function NearbyScreen() {
  const theme = useTheme();
  const snapOptedIn = useSnapOptedIn();
  const [shops, setShops] = useState<NearbyStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadShops = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await fetchNearbyShops();
      setShops(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load nearby shops.');
      if (!refresh) {
        setShops(null);
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

  if (isLoading && shops == null) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="small" themeColor="textSecondary">
          Finding shops near you
        </ThemedText>
      </ThemedView>
    );
  }

  if (error && shops == null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText>{error}</ThemedText>
        <Pressable onPress={() => void loadShops()}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <FlatList
      data={shops ?? []}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void loadShops(true)}
          tintColor={theme.text}
        />
      }
      ListHeaderComponent={
        error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
        ) : undefined
      }
      ListEmptyComponent={
        <ThemedView style={styles.empty}>
          <ThemedText type="subtitle">No shops nearby</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Try a wider area, or check that location is allowed.
          </ThemedText>
          <Pressable onPress={() => void loadShops()}>
            <ThemedText type="linkPrimary">Try again</ThemedText>
          </Pressable>
        </ThemedView>
      }
      renderItem={({ item }) => (
        <ThemedView type="backgroundElement" style={styles.row}>
          <View style={styles.rowText}>
            <View style={styles.nameRow}>
              <ThemedText style={styles.nameFlex}>{item.name}</ThemedText>
              {snapOptedIn && item.accepts_snap ? <SnapBadge size="sm" /> : null}
            </View>
            {item.city ? (
              <ThemedText type="small" themeColor="textSecondary">
                {item.city}
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDistanceKm(item.distance_km)}
          </ThemedText>
        </ThemedView>
      )}
    />
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  empty: {
    padding: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  nameFlex: {
    flexShrink: 1,
  },
});
