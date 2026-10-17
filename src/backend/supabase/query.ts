import { AppError } from '../errors';
import { showErrorToast } from '../toast';

type QueryError = { message: string; code?: string } | null;

function raise(message: string, code?: string): never {
  showErrorToast(message);
  throw new AppError(message, code, true);
}

/**
 * Throws AppError and shows a toast when Supabase returned an error.
 * Use for mutations and RPCs that do not return a useful payload.
 */
export function unwrapVoid(result: { error: QueryError }): void {
  if (result.error) {
    raise(result.error.message, result.error.code);
  }
}

/**
 * Returns the data from a Supabase result or toasts and throws AppError.
 * Empty list selects return [] on success; null data is treated as failure.
 */
export function unwrap<T>(result: { data: T; error: QueryError }): Exclude<T, null> {
  if (result.error) {
    raise(result.error.message, result.error.code);
  }
  if (result.data === null || result.data === undefined) {
    raise('Supabase returned no data.');
  }
  return result.data as Exclude<T, null>;
}

/**
 * Returns one required row. A missing row toasts and throws with `message`.
 */
export function unwrapOne<T>(
  result: { data: T | null; error: QueryError },
  message: string,
): T {
  if (result.error) {
    raise(result.error.message, result.error.code);
  }
  if (result.data === null || result.data === undefined) {
    raise(message);
  }
  return result.data;
}
