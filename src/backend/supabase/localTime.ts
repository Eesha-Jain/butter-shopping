/**
 * Device-timezone helpers for price observation display and day-ahead refresh.
 * DB stores timestamptz (UTC); Shop compares calendar days in the device zone.
 */

export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Calendar date `YYYY-MM-DD` for an ISO timestamptz in the given (or device) zone. */
export function toLocalDateKey(iso: string, timeZone: string = getDeviceTimeZone()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

/** Today's calendar date in the device (or given) timezone. */
export function todayLocalDateKey(timeZone: string = getDeviceTimeZone()): string {
  return toLocalDateKey(new Date().toISOString(), timeZone);
}

/** True when the observation's local calendar day is before today locally. */
export function isPriorLocalCalendarDay(
  iso: string,
  timeZone: string = getDeviceTimeZone(),
): boolean {
  const observed = toLocalDateKey(iso, timeZone);
  const today = todayLocalDateKey(timeZone);
  if (!observed || !today) return false;
  return observed < today;
}

/** Short local datetime for PDP, e.g. "Mar 17, 3:42 PM". */
export function formatLocalDateTime(iso: string, timeZone: string = getDeviceTimeZone()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
