import { getNow } from "@/lib/dates/now";
import {
  policyDateString,
  parseCalendarDateString,
  subtractCalendarYears,
  calendarDateToString,
} from "@/lib/dates/policyDate";

/**
 * Boundary word a real MOIS "혼인기간/혼인신고일 ... N년 (이내|미만|이하|초과|이상)"
 * clause resolves to, expressed the same way the parser's other numeric
 * boundary words already are (see koreanEligibilityParser.ts):
 * 이내/이하 -> "lte", 미만 -> "lt", 이상 -> "gte", 초과 -> "gt".
 */
export type MarriageDurationBoundary = "lte" | "lt" | "gte" | "gt";

export interface MarriageDurationSpec {
  years: number;
  boundary: MarriageDurationBoundary;
}

/**
 * EXACT calendar-date marriage-duration comparison — deliberately NOT built
 * on a floored `differenceInYears` integer, and deliberately NOT built on
 * `Date` INSTANT arithmetic at all.
 *
 * History:
 * 1. An earlier version computed `differenceInYears(now, marriageDate)` and
 *    compared that FLOORED integer against the policy's N. That silently
 *    misclassifies real applicants: someone married 1 year 11 months ago has
 *    `differenceInYears === 1`, so a floored "<= 1" check would WRONGLY pass
 *    a "혼인신고일로부터 1년 이내" ("within 1 year of marriage registration")
 *    requirement for someone who is actually 11 months past that cutoff.
 * 2. A later version fixed the flooring bug by comparing `marriageDate`
 *    against an exact `subYears(startOfDay(referenceDate), years)` `Date`
 *    cutoff — correct, but the comparison was still `Date`-INSTANT-based via
 *    `date-fns`, which reads/constructs `Date`s using the HOST MACHINE's own
 *    configured timezone. A production server (often UTC) and a Korean
 *    user's browser can disagree about which calendar day a given instant
 *    falls on near local midnight, so `startOfDay` alone doesn't fully
 *    remove the timezone dependency — it removes the TIME-OF-DAY dependency
 *    but the DAY ITSELF could still differ depending on which machine
 *    evaluates it.
 *
 * This version fixes BOTH: `referenceInstant` is first converted to a
 * `YYYY-MM-DD` string under the single, explicit Asia/Seoul policy calendar
 * (`policyDateString`, see lib/dates/policyDate.ts), and every comparison
 * from there on — the cutoff subtraction, and the final pass/fail check — is
 * done on plain calendar components / lexicographic `YYYY-MM-DD` string
 * comparison, never on a `Date` instant. No hour, minute, or host timezone
 * can perturb the result; only the Asia/Seoul CALENDAR DATE of
 * `referenceInstant` and the raw `marriageDate` string matter.
 *
 * Greater elapsed duration corresponds to an EARLIER marriage date, so the
 * boundary direction inverts relative to the duration-in-years reading:
 *
 *   "이내"/"이하" (duration <= N)  <=>  marriageDate >= cutoff (inclusive)
 *   "미만"        (duration <  N)  <=>  marriageDate >  cutoff (strict)
 *   "이상"        (duration >= N)  <=>  marriageDate <= cutoff (inclusive)
 *   "초과"        (duration >  N)  <=>  marriageDate <  cutoff (strict)
 *
 * Returns "unknown" (never "fail") for a missing, malformed, or future
 * `marriageDate` — mirroring `calculateAge`'s null-for-unusable-data
 * convention — so missing/bad profile data can never be treated as
 * disqualifying.
 */
export function compareMarriageDurationToThreshold(
  marriageDate: string | undefined,
  spec: MarriageDurationSpec,
  referenceInstant: Date = getNow()
): "pass" | "fail" | "unknown" {
  if (!marriageDate) return "unknown";
  if (!parseCalendarDateString(marriageDate)) return "unknown";

  const todayStr = policyDateString(referenceInstant);
  if (marriageDate > todayStr) return "unknown"; // future marriageDate (safe: both YYYY-MM-DD strings)

  const today = parseCalendarDateString(todayStr);
  if (!today) return "unknown";

  const cutoffStr = calendarDateToString(subtractCalendarYears(today, spec.years));

  switch (spec.boundary) {
    case "lte":
      return marriageDate >= cutoffStr ? "pass" : "fail";
    case "lt":
      return marriageDate > cutoffStr ? "pass" : "fail";
    case "gte":
      return marriageDate <= cutoffStr ? "pass" : "fail";
    case "gt":
      return marriageDate < cutoffStr ? "pass" : "fail";
    default:
      return "unknown";
  }
}
