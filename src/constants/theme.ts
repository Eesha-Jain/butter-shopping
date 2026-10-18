/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/** Same gold as onboarding Continue / full-bleed canvas (`onboarding-shell`). */
export const BUTTER_YELLOW = '#ffd700';

/**
 * Quiet Butter language (main app) — cream canvas, onboarding gold accents:
 * - Canvas = background `#FFFBF0` (never nest mismatched pale-yellow panels)
 * - Quiet well = backgroundElement — photo pads / soft chips idle only
 * - Selected / on-list / butter block = same `#ffd700` as onboarding
 * - Gold = primary — handle, sale mark, CTA label on ink
 * - Ink = text / secondary / borderInk — primary CTAs and selected interactive edges
 *
 * CTA / stepper lock: ink fill + gold label (match onboarding Continue).
 */
export const Colors = {
  light: {
    text: '#000000',
    /** Warm off-white canvas — calmer than onboarding yellow, warmer than pure white. */
    background: '#FFFBF0',
    /** Cream card / chip surface. */
    backgroundElement: '#FFF8E7',
    /** Selected wash — same hue as onboarding yellow. */
    backgroundSelected: BUTTER_YELLOW,
    textSecondary: '#5C5A52',
    primary: BUTTER_YELLOW,
    primaryDark: '#998100',
    primaryText: '#000000',
    secondary: '#000000',
    /** Butter-block fill — matches onboarding yellow. */
    accentSoft: BUTTER_YELLOW,
    /** Soft divider border. */
    border: '#E6DFC8',
    /** Strong ink border for interactive surfaces (chips, cards, inputs). */
    borderInk: '#000000',
    borderError: '#E5484D',
    error: '#E5484D',
    tint: BUTTER_YELLOW,
  },
  dark: {
    text: '#ffffff',
    background: '#12110E',
    backgroundElement: '#1E1C18',
    backgroundSelected: '#2E2A22',
    textSecondary: '#B0B4BA',
    primary: BUTTER_YELLOW,
    primaryDark: BUTTER_YELLOW,
    primaryText: '#000000',
    secondary: '#F5F5F5',
    accentSoft: BUTTER_YELLOW,
    border: '#3A3A3E',
    borderInk: BUTTER_YELLOW,
    borderError: '#E5484D',
    error: '#FF6369',
    tint: BUTTER_YELLOW,
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

/** Shared type sizes — prefer these over ad-hoc fontSize overrides. */
export const Type = {
  pageTitle: 28,
  section: 22,
  body: 16,
  label: 14,
  small: 13,
} as const;

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
  card: 20,
  sheet: 24,
  chip: 999,
} as const;

/** Shared bottom-sheet / modal chrome. */
export const SheetChrome = {
  topRadius: Radius.sheet,
  handleWidth: 36,
  handleHeight: 4,
  /** Warm dim — softer than pure black Material scrim. */
  scrim: 'rgba(40, 35, 20, 0.28)',
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
