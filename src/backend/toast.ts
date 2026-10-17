import * as Burnt from 'burnt';

/**
 * Shows a failure toast. Safe to call from the data layer and from screens.
 * Prefer passing an Error or AppError so the user sees the real message.
 */
export function showErrorToast(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): void {
  const message = messageFromUnknown(error, fallback);
  Burnt.toast({
    title: 'Error',
    message,
    preset: 'error',
    haptic: 'error',
    duration: 3,
  });
}

/** Shows a short success toast for completed actions. */
export function showSuccessToast(title: string, message?: string): void {
  Burnt.toast({
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
