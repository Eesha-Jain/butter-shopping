import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { WeeklyBoardColumn, WeeklyShoppingBoard } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const COLUMN_TONES = {
  today: { bg: '#C8E6C9', text: '#1B5E20' },
  recommended: { bg: '#FFE566', text: '#000000' },
  bestDeal: { bg: '#A67C52', text: '#FFFFFF' },
} as const;

type Props = {
  board: WeeklyShoppingBoard | null;
  loading?: boolean;
  onSignIn?: () => void;
  onColumnPress?: (column: WeeklyBoardColumn) => void;
};

function ColumnCard({
  column,
  onPress,
  onSignIn,
}: {
  column: WeeklyBoardColumn;
  onPress?: () => void;
  onSignIn?: () => void;
}) {
  const tone = COLUMN_TONES[column.id];
  const cards = [
    {
      key: 'main',
      title: column.dateLabel,
      body: column.headline,
      sub: column.timeWindowLabel ?? column.detail,
    },
    {
      key: 'chip',
      title: column.chips[0]?.name ?? '—',
      body: column.chips[0]?.brand ?? column.chips[1]?.name ?? column.detail,
      sub: column.chips[1]?.name ?? null,
    },
  ];

  return (
    <View style={styles.column}>
      <ThemedText type="smallBold" style={styles.columnTitle} numberOfLines={2}>
        {column.title}
      </ThemedText>
      {cards.map((card) => (
        <Pressable
          key={card.key}
          onPress={() => {
            if (column.needsSignIn && onSignIn) {
              onSignIn();
              return;
            }
            onPress?.();
          }}
          style={[styles.card, { backgroundColor: tone.bg }]}>
          <ThemedText type="smallBold" style={{ color: tone.text }} numberOfLines={2}>
            {card.title}
          </ThemedText>
          <ThemedText type="small" style={{ color: tone.text }} numberOfLines={3}>
            {card.body}
          </ThemedText>
          {card.sub ? (
            <ThemedText type="small" style={{ color: tone.text, opacity: 0.9 }} numberOfLines={2}>
              {card.sub}
            </ThemedText>
          ) : null}
        </Pressable>
      ))}
    </View>
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

  return (
    <View style={styles.wrap}>
      <ThemedText type="subtitle" style={styles.heading}>
        Weekly Shopping
      </ThemedText>
      {board.foodPrefNote ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {board.foodPrefNote}
        </ThemedText>
      ) : null}
      <View style={styles.row}>
        {board.columns.map((column) => (
          <ColumnCard
            key={column.id}
            column={column}
            onSignIn={onSignIn}
            onPress={() => onColumnPress?.(column)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  heading: {
    textAlign: 'center',
    fontFamily: Fonts.sansBold,
  },
  note: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  column: {
    flex: 1,
    gap: Spacing.two,
  },
  columnTitle: {
    textAlign: 'center',
    minHeight: 36,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.one,
    minHeight: 110,
    justifyContent: 'flex-start',
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
