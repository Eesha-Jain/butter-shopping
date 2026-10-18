import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoreLogo } from '@/components/plan/store-logo';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SLIDE_MS = 280;
const SLIDE_EASE = Easing.out(Easing.cubic);

type FilterOption = [id: string, label: string];

type Props = {
  visible: boolean;
  groups: FilterOption[];
  locations: FilterOption[];
  selectedGroups: Set<string>;
  selectedLocations: Set<string>;
  onToggleGroup: (id: string) => void;
  onToggleLocation: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
};

export function DayFiltersDrawer({
  visible,
  groups,
  locations,
  selectedGroups,
  selectedLocations,
  onToggleGroup,
  onToggleLocation,
  onClear,
  onClose,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(340, Math.round(width * 0.86));
  const [closing, setClosing] = useState(false);
  const [translateX] = useState(() => new Animated.Value(panelWidth));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    translateX.setValue(panelWidth);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, panelWidth, translateX]);

  const requestClose = (afterClose?: () => void) => {
    if (closing) return;
    setClosing(true);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: panelWidth,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) (afterClose ?? onClose)();
    });
  };

  const renderOptions = (
    options: FilterOption[],
    selected: Set<string>,
    onToggle: (id: string) => void,
    withLogo = false,
  ) => (
    <View style={styles.chipRow}>
      {options.map(([id, label]) => (
        <ButterChip
          key={id}
          label={label}
          icon={withLogo ? <StoreLogo storeName={label} size={20} /> : undefined}
          selected={selected.has(id)}
          onPress={() => onToggle(id)}
        />
      ))}
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => requestClose()}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => requestClose()} />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              backgroundColor: theme.background,
              paddingTop: insets.top + Spacing.three,
              paddingBottom: insets.bottom + Spacing.three,
              borderLeftColor: theme.borderInk,
              transform: [{ translateX }],
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              Filters
            </ThemedText>
            <Pressable
              onPress={() => requestClose()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
                tintColor={theme.text}
              />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">
              Filter orders for this day. Leave unselected to show all.
            </ThemedText>
            {groups.length > 0 ? (
              <>
                <ThemedText type="smallBold">Groups</ThemedText>
                {renderOptions(groups, selectedGroups, onToggleGroup)}
              </>
            ) : null}
            {locations.length > 0 ? (
              <>
                <ThemedText type="smallBold" style={groups.length > 0 ? styles.sectionGap : undefined}>
                  Locations
                </ThemedText>
                {renderOptions(locations, selectedLocations, onToggleLocation, true)}
              </>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onClear} hitSlop={8}>
              <ThemedText type="smallBold" style={{ textDecorationLine: 'underline' }}>
                Clear
              </ThemedText>
            </Pressable>
            <ButterButton
              label="Done"
              variant="ink"
              onPress={() => requestClose()}
              style={styles.doneBtn}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SheetChrome.scrim,
  },
  panel: {
    height: '100%',
    borderLeftWidth: 2,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: Type.section,
  },
  scroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  sectionGap: {
    marginTop: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  doneBtn: {
    flexShrink: 0,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
});
