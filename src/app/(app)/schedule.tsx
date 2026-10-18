import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Type } from '@/constants/theme';

/** Minimal branded placeholder — Days tab owns weekly planning. */
export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.root}>
      <View style={[styles.content, { paddingTop: insets.top + Spacing.four }]}>
        <ThemedText type="smallBold" style={styles.title}>
          Schedule
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
          Weekly shopping plans live on the Days tab. This screen is a placeholder for a future
          calendar view.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontSize: Type.pageTitle,
    lineHeight: 34,
  },
  body: {
    lineHeight: 22,
  },
});
