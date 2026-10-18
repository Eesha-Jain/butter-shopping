import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Alert, Platform, ToastAndroid } from 'react-native';

type ToastOptions = {
  title: string;
  message?: string;
  preset?: 'done' | 'error' | 'none' | 'custom' | 'heart';
  haptic?: 'success' | 'warning' | 'error' | 'none';
  duration?: number;
  from?: 'top' | 'bottom';
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

function fireToastHaptic(kind: ToastOptions['haptic']): void {
  if (!kind || kind === 'none') return;
  // Burnt may also fire haptics in a dev build; Expo Go / fallback never does.
  void (async () => {
    try {
      if (kind === 'error') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (kind === 'warning') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // Web / unsupported devices
    }
  })();
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
  fireToastHaptic(options.haptic);
  const burnt = getBurnt();
  if (!burnt) {
    fallbackToast(options);
    return;
  }
  try {
    // Burnt already received haptic: — pass none so we don't double-buzz in native builds.
    burnt.toast({ ...options, haptic: 'none' });
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

/** Small, non-blocking top toast for add-to-list; no haptic (caller owns it). */
export function showAddedToast(name: string): void {
  const burnt = getBurnt();
  if (burnt) {
    try {
      burnt.toast({
        title: 'Added to list',
        message: name,
        preset: 'none',
        haptic: 'none',
        from: 'top',
        duration: 1.5,
      });
    } catch {
      // Non-critical feedback.
    }
    return;
  }
  // Avoid a blocking Alert in Expo Go on iOS; the card update is the feedback there.
  if (Platform.OS === 'android') ToastAndroid.show(`Added to list: ${name}`, ToastAndroid.SHORT);
}

export function messageFromUnknown(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
