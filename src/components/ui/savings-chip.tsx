import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MIN_SAVINGS_CENTS = 5;

export function formatSavingsCents(cents: number): string {
  const abs = Math.abs(cents);
  return `$${(abs / 100).toFixed(abs % 100 === 0 ? 0 : 2)}`;
}

/** Parse "Save $1.20" / "Save $1" style labels into cents. */
export function parseSavingsLabelCents(label: string | null | undefined): number | null {
  if (!label) return null;
  const match = label.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const dollars = Number(match[1]);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

type Props = {
  /** Positive cents saved. Hidden below 5¢. */
  cents?: number | null;
  /** Override label (e.g. "Save $6.40 this trip"). */
  label?: string | null;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tiny green rect for dollars saved (vs deal-type gold sale marks).
 */
export function SavingsChip({ cents, label, compact = true, style }: Props) {
  const theme = useTheme();
  const resolved =
    label?.trim() ||
    (cents != null && cents >= MIN_SAVINGS_CENTS
      ? `Save ${formatSavingsCents(cents)}`
      : null);
  if (!resolved) return null;

  return (
    <View
      style={[
        styles.chip,
        compact ? styles.compact : styles.roomy,
        { backgroundColor: theme.savings },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={resolved}>
      <Text
        style={[
          styles.text,
          compact ? styles.textCompact : styles.textRoomy,
          { color: theme.savingsText },
        ]}
        numberOfLines={1}>
        {resolved}
      </Text>
    </View>
  );
}

export { MIN_SAVINGS_CENTS };

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.chip,
  },
  compact: {
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 2,
  },
  roomy: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  text: {
    fontFamily: Fonts.sansBold,
  },
  textCompact: {
    fontSize: 11,
    lineHeight: 13,
  },
  textRoomy: {
    fontSize: 12,
    lineHeight: 14,
  },
});
