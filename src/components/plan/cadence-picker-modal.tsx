import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ButterChip } from '@/components/ui/butter-chip';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const CADENCE_OPTIONS = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Every month' },
] as const;

type Props = {
  visible: boolean;
  productName: string;
  onPickDays: (intervalDays: number) => void;
  onDismiss: () => void;
  /** When false, hide “Not a staple” (e.g. staples screen already chose to add). */
  allowSkip?: boolean;
};

/**
 * Tiny sheet: how often should this item return to the grocery list?
 */
export function CadencePickerModal({
  visible,
  productName,
  onPickDays,
  onDismiss,
  allowSkip = true,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              borderColor: theme.borderInk,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <ThemedText type="smallBold" style={styles.title}>
            How often do you buy this?
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {productName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            We’ll add it to your list on that schedule.
          </ThemedText>
          <View style={styles.chips}>
            {CADENCE_OPTIONS.map((opt) => (
              <ButterChip key={opt.days} label={opt.label} onPress={() => onPickDays(opt.days)} />
            ))}
          </View>
          {allowSkip ? (
            <Pressable onPress={onDismiss} hitSlop={8} style={styles.skip}>
              <ThemedText type="small" themeColor="textSecondary">
                Not a staple
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderWidth: 2,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  title: {
    fontSize: Type.section,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
});
