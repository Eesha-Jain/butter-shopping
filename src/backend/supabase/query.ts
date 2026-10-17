import { AppError } from './errors';

type QueryError = { message: string; code?: string } | null;

/**
 * Throws AppError when Supabase returned an error. Use for mutations and RPCs
 * that do not return a useful payload (confirm, finalize, leave, deletes).
 */
export function unwrapVoid(result: { error: QueryError }): void {
  if (result.error) {
    throw new AppError(result.error.message, result.error.code);
  }
}

/**
 * Returns the data from a Supabase result or throws AppError.
 * Null data is treated as failure except for empty arrays from list selects,
 * which PostgREST returns as []. Screens should not inspect raw `{ data, error }`.
 */
export function unwrap<T>(result: { data: T; error: QueryError }): Exclude<T, null> {
  if (result.error) {
    throw new AppError(result.error.message, result.error.code);
  }
  if (result.data === null || result.data === undefined) {
    throw new AppError('Supabase returned no data.');
  }
  return result.data as Exclude<T, null>;
}

/**
 * Returns one required row. Supabase `.maybeSingle()` uses data null when no row matched;
 * this turns that into AppError so callers do not treat a missing profile as an empty object.
 */
export function unwrapOne<T>(
  result: { data: T | null; error: QueryError },
  message: string,
): T {
  if (result.error) {
    throw new AppError(result.error.message, result.error.code);
  }
  if (result.data === null || result.data === undefined) {
    throw new AppError(message);
  }
  return result.data;
}
