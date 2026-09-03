import { getNow } from "./now";

/**
 * Damoa's eligibility catalog and every profile date field (`birthDate`,
 * `marriageDate`) describe ONE fixed real-world calendar: Korean public
 * policy dates. This module used to derive "today"/"is this date in the
 * past" from the RUNTIME's own configured timezone (`Date`'s local getters
 * — `getFullYear`/`getMonth`/`getDate`), which is only correct by
 * coincidence when that runtime happens to also be set to Asia/Seoul. A
 * browser might be; a production server (commonly UTC) is not, and a CI/test
 * runner isn't guaranteed to be either.
 *
 * Concretely: at 2026-09-03 00:30 KST (= 2026-09-02 15:30 UTC), a
 * UTC-configured server and a KST-configured browser would DISAGREE about
 * whether "today" is the 2nd or the 3rd — silently producing different
 * birthDate/marriageDate max-date validation, age, and marriage-duration
 * results depending on which machine happens to evaluate them.
 *
 * The fix: fix ONE explicit policy calendar timezone —
 * `POLICY_TIME_ZONE = "Asia/Seoul"` — and derive "what calendar date is this
 * instant" from it via `Intl.DateTimeFormat(..., { timeZone: POLICY_TIME_ZONE
 * }).formatToParts()`. The ICU/tz-database-backed `Intl` API can format any
 * instant in ANY named timezone regardless of the host machine's own
 * configured timezone, so `policyDateString()` gives the identical answer
 * everywhere.
 *
 * Once a value is a validated `YYYY-MM-DD` policy-calendar string, all
 * further comparisons/arithmetic (`isTodayOrPastPolicyDateString`,
 * `subtractCalendarYears`, and callers like `calculateAge` /
 * `compareMarriageDurationToThreshold`) work on the fixed-width string /
 * `{year, month, day}` components directly — never on `Date` INSTANT
 * arithmetic — so no timezone or hour-of-day can perturb the result. Plain
 * lexicographic string comparison on two zero-padded `YYYY-MM-DD` strings is
 * exactly chronological order, which is what makes this safe.
 */

/** The single fixed calendar timezone every policy date is interpreted in. Never the host machine's own timezone. */
export const POLICY_TIME_ZONE = "Asia/Seoul";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const POLICY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: POLICY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * `YYYY-MM-DD` for `referenceInstant` AS OBSERVED IN THE POLICY TIMEZONE
 * (Asia/Seoul) — deliberately never the host machine's own local timezone or
 * a UTC slice. Safe to use directly as an `<input type="date">` `max`.
 */
export function policyDateString(referenceInstant: Date = getNow()): string {
  const parts = POLICY_DATE_FORMATTER.formatToParts(referenceInstant);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new Error("policyDateString: Intl.DateTimeFormat failed to produce year/month/day parts");
  }
  return `${y}-${m}-${d}`;
}

/** Alias kept for call-site readability at UI date-input call sites — identical to `policyDateString`. */
export function todayPolicyDateString(referenceInstant: Date = getNow()): string {
  return policyDateString(referenceInstant);
}

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

/**
 * Parses a `YYYY-MM-DD` string into calendar components, or `null` if it
 * isn't a real calendar date (rejects e.g. "2026-02-30", "2025-02-29" — not
 * a leap year — and "2026-13-01"). Pure integer arithmetic — no `Date`
 * construction, so no timezone can affect the answer, unlike the previous
 * design's `new Date(y, m-1, d)` round-trip.
 */
export function parseCalendarDateString(value: string): CalendarDate | null {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const [yStr, mStr, dStr] = value.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** True only for a syntactically well-formed `YYYY-MM-DD` string that is ALSO a real calendar date. Timezone-free. */
export function isValidCalendarDateString(value: string): boolean {
  return parseCalendarDateString(value) !== null;
}

export function calendarDateToString(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/**
 * Subtracts whole calendar years from a date, clamping Feb 29 -> Feb 28 when
 * the target year isn't a leap year (matches date-fns `subYears`'s own
 * clamping behavior, reimplemented here on plain calendar components instead
 * of a `Date` instant so no timezone is ever involved).
 */
export function subtractCalendarYears(date: CalendarDate, years: number): CalendarDate {
  const targetYear = date.year - years;
  if (date.month === 2 && date.day === 29 && !isLeapYear(targetYear)) {
    return { year: targetYear, month: 2, day: 28 };
  }
  return { year: targetYear, month: date.month, day: date.day };
}

/**
 * True when `value` is a valid calendar date string that is today-or-earlier
 * IN THE POLICY CALENDAR (Asia/Seoul). Comparison is plain lexicographic
 * string comparison on two `YYYY-MM-DD` strings — exactly chronological
 * order for fixed-width, zero-padded ISO date strings — so there is no
 * `Date` instant comparison, and therefore no timezone-shift risk, on either
 * side.
 */
export function isTodayOrPastPolicyDateString(value: string, referenceInstant: Date = getNow()): boolean {
  return isValidCalendarDateString(value) && value <= policyDateString(referenceInstant);
}
