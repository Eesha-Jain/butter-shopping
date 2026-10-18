import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  hint?: string;
};

/** Soft ink rule + label between Plan sections. */
export function SectionDivider({ label, hint }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={[styles.rule, { backgroundColor: theme.borderInk }]} />
      <View style={styles.textCol}>
        <ThemedText type="smallBold" style={styles.label}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  rule: {
    height: 2,
    opacity: 0.85,
    borderRadius: 1,
  },
  textCol: {
    gap: 2,
  },
  label: {
    fontSize: Type.section,
    lineHeight: 26,
  },
});
