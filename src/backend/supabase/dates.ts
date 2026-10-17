/**
 * Weekdays match the database: 0 is Sunday and 6 is Saturday, the same numbers
 * as JavaScript `Date.getDay()` and Postgres `extract(dow)`.
 */
export function nextPreferredGroceryDate(
  preferredDays: readonly number[] | null | undefined,
  from = new Date(),
): string {
  const allowed =
    preferredDays && preferredDays.length > 0 ? new Set(preferredDays) : null;

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    if (!allowed || allowed.has(day.getDay())) {
      return formatDate(day);
    }
  }

  return formatDate(from);
}

function formatDate(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}
