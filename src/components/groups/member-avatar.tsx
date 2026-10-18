import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Distinct fills so members without a photo are still easy to tell apart.
const FALLBACK_FILLS = ['#FFD84D', '#9AD0F5', '#F7A8B8', '#A8E6A1', '#C9B6F2', '#FFB877'];

function hashIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % size;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

type Props = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  size?: number;
  /** Ring color, e.g. to highlight whoever is up next. */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function MemberAvatar({ userId, name, avatarUrl, size = 32, ringColor, style }: Props) {
  const theme = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.wrap,
        box,
        {
          borderColor: ringColor ?? theme.background,
          backgroundColor: FALLBACK_FILLS[hashIndex(userId, FALLBACK_FILLS.length)],
        },
        style,
      ]}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <ThemedText
          style={[
            styles.initials,
            { fontSize: Math.max(9, size * 0.4), lineHeight: Math.max(11, size * 0.5) },
          ]}>
          {initials(name)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: Fonts.sansBold,
    color: '#000000',
  },
});
