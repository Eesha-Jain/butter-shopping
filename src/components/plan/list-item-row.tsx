import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function cadenceLabel(intervalDays: number): string {
  if (intervalDays === 7) return 'Weekly';
  if (intervalDays === 14) return 'Every 2 weeks';
  if (intervalDays === 1) return 'Daily';
  return `Every ${intervalDays} days`;
}

type Props = {
  title: string;
  quantity?: number;
  priceCents?: number | null;
  imagePath?: string | null;
  cadenceTag?: string | null;
  recipeTag?: boolean;
  dueLabel?: string | null;
  done?: boolean;
  onDone: () => void;
  onDelete: () => void;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Day-list row: photo, tags, swipe left delete / swipe right done. */
export function ListItemRow({
  title,
  quantity,
  priceCents,
  imagePath,
  cadenceTag,
  recipeTag,
  dueLabel,
  done = false,
  onDone,
  onDelete,
}: Props) {
  const theme = useTheme();
  const swipeRef = useRef<Swipeable>(null);
  const letter = title.trim().slice(0, 1) || '?';

  const renderRight = () => (
    <Pressable
      onPress={() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        swipeRef.current?.close();
        onDelete();
      }}
      style={[styles.action, { backgroundColor: theme.error }]}
      accessibilityRole="button"
      accessibilityLabel="Delete item">
      <ThemedText type="smallBold" style={styles.actionLabel}>
        Delete
      </ThemedText>
    </Pressable>
  );

  const renderLeft = () => (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        swipeRef.current?.close();
        onDone();
      }}
      style={[styles.action, { backgroundColor: theme.secondary }]}
      accessibilityRole="button"
      accessibilityLabel={done ? 'Mark not done' : 'Mark done'}>
      <ThemedText type="smallBold" style={[styles.actionLabel, { color: theme.primary }]}>
        {done ? 'Undo' : 'Done'}
      </ThemedText>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRight}
      renderLeftActions={renderLeft}
      overshootLeft={false}
      overshootRight={false}
      friction={2}>
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onDone();
        }}
        style={[
          styles.row,
          {
            backgroundColor: theme.background,
            borderColor: theme.borderInk,
            opacity: done ? 0.55 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ checked: done }}>
        <ProductPhoto imagePath={imagePath} placeholderLetter={letter} size={48} />
        <View style={styles.body}>
          <ThemedText
            type="smallBold"
            style={[styles.title, done ? styles.titleDone : null]}
            numberOfLines={2}>
            {title}
          </ThemedText>
          <View style={styles.meta}>
            {quantity != null && quantity > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                qty {quantity}
              </ThemedText>
            ) : null}
            {priceCents != null ? (
              <ThemedText type="small" themeColor="textSecondary">
                {formatMoney(priceCents)}
              </ThemedText>
            ) : null}
            {dueLabel ? (
              <ThemedText type="small" themeColor="textSecondary">
                {dueLabel}
              </ThemedText>
            ) : null}
          </View>
          {cadenceTag || recipeTag ? (
            <View style={styles.tags}>
              {cadenceTag ? (
                <View
                  style={[
                    styles.tag,
                    { borderColor: theme.borderInk, backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText type="small" style={styles.tagText}>
                    {cadenceTag}
                  </ThemedText>
                </View>
              ) : null}
              {recipeTag ? (
                <View
                  style={[
                    styles.tag,
                    { borderColor: theme.borderInk, backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText type="small" style={styles.tagText}>
                    Recipe
                  </ThemedText>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    lineHeight: 18,
  },
  titleDone: {
    textDecorationLine: 'line-through',
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  tag: {
    borderWidth: 1.5,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  tagText: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
  },
  action: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 88,
    marginBottom: Spacing.two,
    borderRadius: Radius.card,
  },
  actionLabel: {
    color: '#fff',
    fontSize: 14,
  },
});
