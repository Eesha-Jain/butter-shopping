import { Pressable, StyleSheet, View } from 'react-native';

import type { ShoppingPlanLine } from '@/backend';
import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StorePlanGroup = {
  storeId: string;
  storeName: string;
  lines: ShoppingPlanLine[];
  totalCents: number;
};

type Props = {
  group: StorePlanGroup;
  expanded: boolean;
  ordering: boolean;
  /** list_item_id → product image_path */
  imageByListItemId?: Map<string, string | null>;
  onToggle: () => void;
  onOrder: () => void;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function StoreOrderCard({
  group,
  expanded,
  ordering,
  imageByListItemId,
  onToggle,
  onOrder,
}: Props) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.borderInk },
      ]}>
      <Pressable onPress={onToggle} style={styles.header} accessibilityRole="button">
        <View style={styles.headerText}>
          <ThemedText type="smallBold">{group.storeName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {group.lines.length} item{group.lines.length === 1 ? '' : 's'} ·{' '}
            {formatMoney(group.totalCents)}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {expanded ? 'Hide' : 'Show'}
        </ThemedText>
      </Pressable>

      {expanded ? (
        <View style={[styles.lines, { borderTopColor: theme.border }]}>
          {group.lines.map((line) => {
            const name = line.display_name?.trim() || 'Item';
            const imagePath = imageByListItemId?.get(line.list_item_id) ?? null;
            return (
              <View key={line.list_item_id} style={styles.line}>
                <ProductPhoto
                  imagePath={imagePath}
                  placeholderLetter={name.slice(0, 1)}
                  size={36}
                />
                <ThemedText type="small" style={styles.lineName} numberOfLines={2}>
                  {name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {line.line_cents != null ? formatMoney(line.line_cents) : '—'}
                </ThemedText>
              </View>
            );
          })}
        </View>
      ) : null}

      <ButterButton
        label={ordering ? 'Ordering…' : 'Order'}
        variant="ink"
        disabled={ordering}
        onPress={onOrder}
        style={styles.orderBtn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 3,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  lines: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  lineName: {
    flex: 1,
  },
  orderBtn: {
    minHeight: 44,
  },
});
