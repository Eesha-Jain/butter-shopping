/**
 * Error raised when Supabase returns a failure or a required row is missing.
 * `code` is the Postgres or PostgREST error code when Supabase provides one.
 */
export class AppError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
