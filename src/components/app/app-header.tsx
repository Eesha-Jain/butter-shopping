import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppProfile } from '@/auth/app-profile';
import { publicImageUrl } from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  subtitle?: string;
  /** Optional third line (location, list name, etc.). */
  meta?: ReactNode;
  /** Trailing actions (e.g. Plan staples / groups). */
  right?: ReactNode;
};

/**
 * Shared tab chrome: profile avatar + page title.
 * Owns safe-area top padding so screens should not also add insets.top.
 */
export function AppHeader({ title, subtitle, meta, right }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { avatarPath, avatarVersion, openProfile } = useAppProfile();

  const avatarBaseUrl = publicImageUrl('avatars', avatarPath);
  const avatarUrl = avatarBaseUrl ? `${avatarBaseUrl}?t=${avatarVersion}` : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.two }]}>
      <View style={styles.row}>
        {/* Horizontal padding lives on the screen scroll content so this aligns with body. */}
        <Pressable
          onPress={openProfile}
          hitSlop={8}
          style={[
            styles.avatarBtn,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open profile">
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <SymbolView
              name={{
                ios: 'person.crop.circle.fill',
                android: 'account_circle',
                web: 'account_circle',
              }}
              size={28}
              tintColor={theme.textSecondary}
            />
          )}
        </Pressable>

        <View style={styles.copy}>
          <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {subtitle}
            </ThemedText>
          ) : null}
          {meta}
        </View>

        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  avatarBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontSize: Type.pageTitle,
    lineHeight: 32,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
});
