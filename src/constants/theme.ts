/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    primary: '#ffd700',
    primaryDark: '#998100',
    primaryText: '#000000',
    secondary: '#000000',
    accentSoft: '#f0e68c',
    border: '#D8D8DE',
    borderError: '#E5484D',
    error: '#E5484D',
    tint: '#ffd700',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    primary: '#ffd700',
    primaryDark: '#998100',
    primaryText: '#000000',
    secondary: '#F5F5F5',
    accentSoft: '#f0e68c',
    border: '#3A3A3E',
    borderError: '#E5484D',
    error: '#FF6369',
    tint: '#ffd700',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Loaded in root layout via `@expo-google-fonts/comic-neue`. */
export const Fonts = {
  /** Body / UI copy (matches login & signup). */
  sans: 'ComicNeue_400Regular',
  /** Emphasized UI copy. */
  sansBold: 'ComicNeue_700Bold',
  mono: Platform.select({
    ios: 'ui-monospace',
    android: 'monospace',
    default: 'monospace',
    web: 'var(--font-mono)',
  }) as string,
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  input: 16,
  button: 16,
  card: 24,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
