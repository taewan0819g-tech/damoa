import { getNow } from "./now";

/**
 * Date-only (no time-of-day) helpers for `<input type="date">` fields —
 * birthDate, marriageDate.
 *
 * `new Date().toISOString().slice(0, 10)` (the pattern this module replaces)
 * converts to UTC before slicing. For a user in Korea (UTC+9), during the
 * first ~9 hours of any local calendar day, that produces YESTERDAY's date
 * — e.g. at 2026-09-02 02:00 KST, `toISOString()` reports "2026-09-01",
 * which would incorrectly reject 2026-09-02 as a valid (today-or-past)
 * `max` value. `<input type="date">` is a pure calendar-date control with no
 * timezone of its own — it must be compared against the browser's LOCAL
 * calendar date, never a UTC-shifted one. Every function here reads a
 * `Date`'s own local getters (`getFullYear`/`getMonth`/`getDate`), never
 * `toISOString`/`getUTC*`, so in a real browser (running in the user's own
 * timezone) "today" always means the user's own local today.
 *
 * Also provides strict calendar validity: JS `Date` silently auto-normalizes
 * an impossible date (`new Date(2026, 1, 30)` becomes March 2, 2026) instead
 * of rejecting it — `isValidCalendarDateString` reverses that construction
 * and rejects anything that didn't round-trip, so "2026-02-30" is correctly
 * treated as invalid rather than silently becoming March 2.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` from a `Date`'s LOCAL calendar fields — never UTC. */
export function localDateStringFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's date, as `YYYY-MM-DD`, in the caller's LOCAL calendar — safe to use directly as an `<input type="date">` `max`. */
export function todayLocalDateString(referenceDate: Date = getNow()): string {
  return localDateStringFromDate(referenceDate);
}

/**
 * True only for a syntactically well-formed `YYYY-MM-DD` string that is
 * ALSO a real calendar date (rejects e.g. "2026-02-30", "2025-02-29" —
 * not a leap year — and "2026-13-01"), without relying on `Date`'s
 * auto-normalizing constructor to silently "fix" an impossible date.
 */
export function isValidCalendarDateString(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

/**
 * True when `value` is a valid calendar date string that is today or
 * earlier, compared as LOCAL calendar dates (plain lexicographic string
 * comparison on `YYYY-MM-DD` is exactly chronological order, and both sides
 * are already local-calendar strings — no `Date` instant comparison, so
 * there is no UTC-shift risk on either side).
 */
export function isTodayOrPastLocalDateString(value: string, referenceDate: Date = getNow()): boolean {
  return isValidCalendarDateString(value) && value <= todayLocalDateString(referenceDate);
}
