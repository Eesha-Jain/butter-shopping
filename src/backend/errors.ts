import { messageFromUnknown, showErrorToast } from './toast';

/**
 * Error raised when a backend call fails or a required row is missing.
 * `code` is the Postgres or PostgREST error code when Supabase provides one.
 * `toasted` is true after an error toast has already been shown for this error,
 * so callers do not show the same failure twice.
 */
export class AppError extends Error {
  readonly code: string | undefined;
  readonly toasted: boolean;

  constructor(message: string, code?: string, toasted = false) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.toasted = toasted;
  }
}

/**
 * Turns any thrown value into an AppError, shows an error toast once, and
 * rethrows. Domain helpers already toast through unwrap*; use this for Auth
 * errors, Edge Function failures, and validation that throws before a query.
 */
export function fail(error: unknown, fallback = 'Something went wrong. Please try again.'): never {
  if (error instanceof AppError) {
    if (!error.toasted) {
      showErrorToast(error.message, fallback);
      throw new AppError(error.message, error.code, true);
    }
    throw error;
  }

  if (typeof error === 'string') {
    const message = error.trim() || fallback;
    showErrorToast(message, fallback);
    throw new AppError(message, undefined, true);
  }

  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const message = messageFromUnknown(error, fallback);
  showErrorToast(message, fallback);
  throw new AppError(message, code, true);
}

/**
 * Runs an async backend call. On failure, shows a toast and rethrows AppError.
 *
 *   await runAction(() => createTripFromList({ ... }));
 */
export async function runAction<T>(action: () => Promise<T>, fallback?: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    fail(error, fallback);
  }
}
