import Constants from 'expo-constants';
import { Alert, Platform, ToastAndroid } from 'react-native';

type ToastOptions = {
  title: string;
  message?: string;
  preset?: 'done' | 'error' | 'none' | 'custom' | 'heart';
  haptic?: 'success' | 'warning' | 'error' | 'none';
  duration?: number;
};

type BurntModule = {
  toast: (options: ToastOptions) => void;
};

/** Expo Go does not ship Burnt's native module. */
const isExpoGo = Constants.appOwnership === 'expo';

function getBurnt(): BurntModule | null {
  if (isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('burnt') as BurntModule;
  } catch {
    return null;
  }
}

function fallbackToast(options: ToastOptions): void {
  const body = [options.title, options.message].filter(Boolean).join('\n');
  if (Platform.OS === 'android') {
    ToastAndroid.show(body, ToastAndroid.LONG);
    return;
  }
  Alert.alert(options.title, options.message);
}

function showToast(options: ToastOptions): void {
  const burnt = getBurnt();
  if (!burnt) {
    fallbackToast(options);
    return;
  }
  try {
    burnt.toast(options);
  } catch {
    fallbackToast(options);
  }
}

/**
 * Shows a failure toast. Safe to call from the data layer and from screens.
 * Prefer passing an Error or AppError so the user sees the real message.
 * Uses Burnt in development builds; falls back to Alert / ToastAndroid in Expo Go.
 */
export function showErrorToast(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): void {
  showToast({
    title: 'Error',
    message: messageFromUnknown(error, fallback),
    preset: 'error',
    haptic: 'error',
    duration: 3,
  });
}

/** Shows a short success toast for completed actions. */
export function showSuccessToast(title: string, message?: string): void {
  showToast({
    title,
    message,
    preset: 'done',
    haptic: 'success',
    duration: 2,
  });
}

export function messageFromUnknown(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
