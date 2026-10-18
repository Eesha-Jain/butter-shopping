import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { WeeklyBoardChip, WeeklyBoardColumn, WeeklyShoppingBoard } from '@/backend';
import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  board: WeeklyShoppingBoard | null;
  loading?: boolean;
  onSignIn?: () => void;
  onColumnPress?: (column: WeeklyBoardColumn) => void;
};

const CHIP_LABEL: Record<WeeklyBoardColumn['id'], string> = {
  today: 'Today',
  recommended: 'Recommended',
  bestDeal: 'Best deal',
};

function ProductThumb({ chip }: { chip: WeeklyBoardChip }) {
  const theme = useTheme();
  const imageUrl = publicImageUrl('public-assets', chip.imagePath);
  return (
    <View style={styles.thumbWrap}>
      <View
        style={[
          styles.thumb,
          { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
        ]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.thumbImage} contentFit="contain" />
        ) : (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {chip.name.slice(0, 1).toUpperCase()}
          </ThemedText>
        )}
      </View>
      <ThemedText type="small" numberOfLines={2} style={styles.thumbName}>
        {chip.name}
      </ThemedText>
    </View>
  );
}

function DayCard({
  column,
  featured,
  onPress,
  onSignIn,
}: {
  column: WeeklyBoardColumn;
  featured?: boolean;
  onPress?: () => void;
  onSignIn?: () => void;
}) {
  const theme = useTheme();
  const ctaLabel = column.needsSignIn
    ? 'Sign in for deals'
    : column.id === 'recommended'
      ? 'Plan this trip'
      : column.id === 'today'
        ? 'Shop today'
        : 'See deals';

  return (
    <Pressable
      onPress={() => {
        if (column.needsSignIn && onSignIn) {
          onSignIn();
          return;
        }
        onPress?.();
      }}
      style={[
        styles.card,
        featured && styles.cardFeatured,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.borderInk,
        },
      ]}>
      {featured ? (
        <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.chipRow}>
          <ButterChip
            label={CHIP_LABEL[column.id]}
            selected={featured ?? false}
            onPress={() => {
              if (column.needsSignIn && onSignIn) {
                onSignIn();
                return;
              }
              onPress?.();
            }}
          />
        </View>
        <ThemedText type="smallBold" style={featured ? styles.featuredDate : undefined}>
          {column.dateLabel}
        </ThemedText>
        <ThemedText type={featured ? 'smallBold' : 'small'} numberOfLines={2}>
          {column.headline}
        </ThemedText>
        {column.timeWindowLabel || column.detail ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {column.timeWindowLabel ?? column.detail}
          </ThemedText>
        ) : null}

        {column.chips.length > 0 ? (
          <View style={styles.thumbs}>
            {column.chips.slice(0, featured ? 4 : 2).map((chip) => (
              <ProductThumb key={chip.productId} chip={chip} />
            ))}
          </View>
        ) : null}

        <ButterButton
          label={ctaLabel}
          variant={featured ? 'ink' : column.needsSignIn ? 'yellow' : 'ghost'}
          onPress={() => {
            if (column.needsSignIn && onSignIn) {
              onSignIn();
              return;
            }
            onPress?.();
          }}
          style={styles.cta}
        />
      </View>
    </Pressable>
  );
}

export function WeeklyShoppingBoardView({ board, loading, onSignIn, onColumnPress }: Props) {
  const theme = useTheme();

  if (loading && !board) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
        <ThemedText type="small" themeColor="textSecondary">
          Planning your week…
        </ThemedText>
      </View>
    );
  }

  if (!board) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
        Could not load weekly shopping suggestions.
      </ThemedText>
    );
  }

  const recommended = board.columns.find((c) => c.id === 'recommended');
  const today = board.columns.find((c) => c.id === 'today');
  const bestDeal = board.columns.find((c) => c.id === 'bestDeal');

  return (
    <View style={styles.wrap}>
      {board.foodPrefNote ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {board.foodPrefNote}
        </ThemedText>
      ) : null}

      {recommended ? (
        <DayCard
          column={recommended}
          featured
          onSignIn={onSignIn}
          onPress={() => onColumnPress?.(recommended)}
        />
      ) : null}

      <View style={styles.secondaryRow}>
        {today ? (
          <View style={styles.secondaryCol}>
            <DayCard column={today} onSignIn={onSignIn} onPress={() => onColumnPress?.(today)} />
          </View>
        ) : null}
        {bestDeal ? (
          <View style={styles.secondaryCol}>
            <DayCard
              column={bestDeal}
              onSignIn={onSignIn}
              onPress={() => onColumnPress?.(bestDeal)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  note: {
    textAlign: 'center',
  },
  card: {
    borderWidth: 2,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  cardFeatured: {
    minHeight: 200,
  },
  accentBar: {
    height: 6,
    width: '100%',
  },
  cardBody: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  featuredDate: {
    fontSize: Type.section,
  },
  thumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  thumbWrap: {
    width: 64,
    gap: Spacing.half,
    alignItems: 'center',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: Radius.button,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: Spacing.half,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbName: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
  },
  cta: {
    marginTop: Spacing.one,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'stretch',
  },
  secondaryCol: {
    flex: 1,
  },
  loading: {
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  empty: {
    textAlign: 'center',
    padding: Spacing.four,
  },
});
