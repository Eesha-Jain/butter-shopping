import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { ProductPhoto } from '@/components/shop/product-photo';
import { ThemedText } from '@/components/themed-text';
import { SavingsChip } from '@/components/ui/savings-chip';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

const CHECK_GREEN = '#2E9E5B';

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
  /** Cents saved vs regular / baseline for this line. */
  savingsCents?: number | null;
  imagePath?: string | null;
  cadenceTag?: string | null;
  recipeTag?: boolean;
  dueLabel?: string | null;
  done?: boolean;
  /** `origin` is the checkbox's center in window coordinates (when measurable). */
  onDone: (origin?: { x: number; y: number }) => void;
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
  savingsCents,
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

  const checkboxRef = useRef<View>(null);

  const toggle = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const box = checkboxRef.current;
    if (!box) {
      onDone();
      return;
    }
    box.measureInWindow((x, y, w, h) => {
      onDone(w || h ? { x: x + w / 2, y: y + h / 2 } : undefined);
    });
  };

  const remove = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onDelete();
  };

  // Swiping right reveals the left-side action (check); swiping left reveals the right side (delete).
  const renderLeft = () => (
    <View style={[styles.action, styles.actionLeft, { backgroundColor: CHECK_GREEN }]}>
      <SymbolView
        name={
          {
            ios: done ? 'arrow.uturn.backward' : 'checkmark',
            android: done ? 'undo' : 'check',
            web: done ? 'undo' : 'check',
          } as SymbolName
        }
        size={24}
        tintColor="#fff"
      />
    </View>
  );

  const renderRight = () => (
    <View style={[styles.action, styles.actionRight, { backgroundColor: theme.error }]}>
      <SymbolView
        name={{ ios: 'trash.fill', android: 'delete', web: 'delete' } as SymbolName}
        size={24}
        tintColor="#fff"
      />
    </View>
  );

  return (
    <Animated.View layout={LinearTransition.duration(300)}>
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRight}
      renderLeftActions={renderLeft}
      overshootLeft={false}
      overshootRight={false}
      leftThreshold={72}
      rightThreshold={72}
      friction={1.5}
      onSwipeableOpen={(direction) => {
        swipeRef.current?.close();
        if (direction === 'left') toggle();
        else remove();
      }}>
      <View
        style={[
          styles.row,
          { backgroundColor: theme.background, opacity: done ? 0.55 : 1 },
        ]}>
        <Pressable
          ref={checkboxRef}
          onPress={toggle}
          hitSlop={10}
          style={[
            styles.checkbox,
            {
              borderColor: done ? CHECK_GREEN : theme.textSecondary,
              backgroundColor: done ? CHECK_GREEN : 'transparent',
            },
          ]}
          accessibilityRole="checkbox"
          accessibilityLabel={title}
          accessibilityState={{ checked: done }}>
          {done ? (
            <SymbolView
              name={{ ios: 'checkmark', android: 'check', web: 'check' } as SymbolName}
              size={14}
              tintColor="#fff"
            />
          ) : null}
        </Pressable>
        <View style={[styles.photoWrap, { backgroundColor: theme.backgroundElement }]}>
          <ProductPhoto imagePath={imagePath} placeholderLetter={letter} size={52} />
        </View>
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
            {savingsCents != null && savingsCents > 0 ? (
              <SavingsChip
                cents={savingsCents}
                label={`−${formatMoney(savingsCents)}`}
              />
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
      </View>
    </Swipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoWrap: {
    borderRadius: 14,
    overflow: 'hidden',
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
    marginVertical: 2,
  },
  actionLeft: {
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  actionRight: {
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
});
