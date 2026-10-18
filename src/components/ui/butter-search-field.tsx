import { SymbolView } from 'expo-symbols';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = TextInputProps & {
  /** Optional trailing control (e.g. filter button) rendered outside this field. */
};

/** Cream search field with ink border — pairs with filter ButterButton. */
export function ButterSearchField({ style, ...rest }: Props) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.field,
        {
          backgroundColor: theme.background,
          borderColor: theme.borderInk,
        },
      ]}>
      <SymbolView
        name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
        size={18}
        tintColor={theme.textSecondary}
      />
      <TextInput
        {...rest}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text }, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
});
