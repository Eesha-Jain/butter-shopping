import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import {
  getWeeklyShoppingBoard,
  listMyLocations,
  resolveShopZip,
  showSuccessToast,
  type WeeklyBoardColumn,
  type WeeklyShoppingBoard,
} from '@/backend';
import { WeeklyShoppingBoardView } from '@/components/shop/weekly-shopping-board';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function DaysScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isGuest, requestSignIn } = useSession();
  const [board, setBoard] = useState<WeeklyShoppingBoard | null>(null);
  const [locationLabel, setLocationLabel] = useState('Campus area');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const zip = await resolveShopZip().catch(() => '98195');
        if (!isGuest) {
          const locations = await listMyLocations().catch(() => []);
          const home = locations.find((row) => row.is_default) ?? locations[0];
          if (home) {
            const line = [home.address_line1, home.city, home.region, home.postal_code]
              .filter(Boolean)
              .join(', ');
            setLocationLabel(line || zip);
          } else {
            setLocationLabel(zip);
          }
        } else {
          setLocationLabel(zip);
        }
        const next = await getWeeklyShoppingBoard({ postalCode: zip, isGuest });
        setBoard(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load weekly shopping.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isGuest],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onColumnPress = (column: WeeklyBoardColumn) => {
    const bits = [column.dateLabel, column.headline, column.timeWindowLabel, column.detail].filter(
      Boolean,
    );
    showSuccessToast(column.title, bits.join(' · '));
  };

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.three,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={theme.text}
          />
        }>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {locationLabel}
          </ThemedText>
        </View>

        {error && !board ? (
          <View style={styles.centered}>
            <ThemedText>{error}</ThemedText>
            <Pressable onPress={() => void load()}>
              <ThemedText type="linkPrimary">Try again</ThemedText>
            </Pressable>
          </View>
        ) : loading && !board ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : (
          <WeeklyShoppingBoardView
            board={board}
            loading={loading}
            onSignIn={requestSignIn}
            onColumnPress={onColumnPress}
          />
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    gap: Spacing.four,
  },
  header: {
    paddingHorizontal: Spacing.four,
  },
  centered: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
    gap: Spacing.two,
  },
});
