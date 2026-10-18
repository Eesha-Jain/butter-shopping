import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type WeekDayCell = {
  ymd: string;
  weekday: string;
  dayNum: string;
  isToday: boolean;
  isRecommended: boolean;
  hasHabitsDue: boolean;
  isBestDeal: boolean;
};

type Props = {
  days: WeekDayCell[];
  selectedYmd: string | null;
  onSelect: (ymd: string) => void;
};

/** Onboarding-chip week: selected = ink fill + gold labels; idle = cream + ink border. */
export function WeekStrip({ days, selectedYmd, onSelect }: Props) {
  const theme = useTheme();

  return (
    <View style={[styles.wash, { backgroundColor: theme.backgroundSelected }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        {days.map((day) => {
          const selected = day.ymd === selectedYmd;
          const accent = day.isRecommended || day.isBestDeal || day.hasHabitsDue;
          const labelColor = selected ? theme.primary : theme.text;
          const mutedColor = selected ? theme.primary : theme.textSecondary;
          return (
            <Pressable
              key={day.ymd}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelect(day.ymd);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.cell,
                {
                  backgroundColor: selected ? theme.secondary : theme.background,
                  borderColor: selected || accent ? theme.borderInk : theme.border,
                },
              ]}>
              <ThemedText type="small" style={[styles.weekday, { color: mutedColor }]}>
                {day.weekday}
              </ThemedText>
              <ThemedText type="smallBold" style={[styles.dayNum, { color: labelColor }]}>
                {day.dayNum}
              </ThemedText>
              <View style={styles.dots}>
                {day.isRecommended ? (
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: selected ? theme.primary : theme.secondary },
                    ]}
                  />
                ) : null}
                {day.hasHabitsDue ? (
                  <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                ) : null}
                {day.isBestDeal ? (
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: selected ? theme.primary : theme.primaryDark },
                    ]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wash: {
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  cell: {
    width: 52,
    borderWidth: 2,
    borderRadius: Radius.chip,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: 2,
  },
  weekday: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  dayNum: {
    fontFamily: Fonts.sansBold,
    fontSize: 18,
    lineHeight: 22,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
    minHeight: 6,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
