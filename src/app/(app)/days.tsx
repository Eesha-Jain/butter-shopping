import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import {
  getWeeklyShoppingBoard,
  listMyLocations,
  resolveShopZip,
  type WeeklyBoardColumn,
  type WeeklyShoppingBoard,
} from '@/backend';
import { WeeklyShoppingBoardView } from '@/components/shop/weekly-shopping-board';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ButterButton } from '@/components/ui/butter-button';
import { BottomTabInset, Spacing, Type } from '@/constants/theme';
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
    if (column.needsSignIn) {
      requestSignIn();
      return;
    }
    // Open Shop so the user can act on the plan.
    router.push('/');
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
        <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
          <ThemedText type="smallBold" style={styles.title}>
            This week
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {locationLabel}
          </ThemedText>
        </Animated.View>

        {error && !board ? (
          <View style={styles.centered}>
            <ThemedText>{error}</ThemedText>
            <ButterButton label="Try again" variant="yellow" onPress={() => void load()} />
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
    gap: Spacing.one,
  },
  title: {
    fontSize: Type.pageTitle,
    lineHeight: 34,
  },
  centered: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
});
