import { getNow } from "@/lib/dates/now";
import { policyDateString, parseCalendarDateString } from "@/lib/dates/policyDate";

/**
 * Returns the person's current (Korean "만 나이") age from an ISO birth
 * date. Returns `null` for missing, malformed, or future birth dates rather
 * than throwing, so callers can treat age as "unknown" instead of crashing.
 *
 * Deliberately calendar-date based, not `Date`-instant based:
 * `age = referenceYear - birthYear - (1 if referenceMonthDay < birthMonthDay
 * else 0)`, evaluated entirely on integer year/month/day components under
 * the Asia/Seoul policy calendar (see lib/dates/policyDate.ts) — never via
 * `date-fns`' `differenceInYears(Date, Date)`, which operates on `Date`
 * INSTANTS and therefore silently depends on whatever timezone the host
 * machine happens to be configured with. A production server (often UTC)
 * and a Korean user's browser can disagree about which calendar day
 * `referenceInstant` falls on near local midnight; deriving both `birthDate`
 * and "today" as Asia/Seoul calendar strings first, then comparing only
 * their year/month/day components, makes the result identical everywhere
 * regardless of the evaluating machine's own timezone.
 */
export function calculateAge(birthDate: string | undefined, referenceInstant: Date = getNow()): number | null {
  if (!birthDate) return null;
  const birth = parseCalendarDateString(birthDate);
  if (!birth) return null;

  const todayStr = policyDateString(referenceInstant);
  if (birthDate > todayStr) return null; // future birth date (safe: both are YYYY-MM-DD strings)
  const today = parseCalendarDateString(todayStr);
  if (!today) return null;

  let age = today.year - birth.year;
  const todayMonthDay = today.month * 100 + today.day;
  const birthMonthDay = birth.month * 100 + birth.day;
  if (todayMonthDay < birthMonthDay) age -= 1;

  if (age < 0 || age > 130) return null;
  return age;
}
