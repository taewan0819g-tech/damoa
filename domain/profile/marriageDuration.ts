import { isValid, parseISO, subYears } from "date-fns";
import { getNow } from "@/lib/dates/now";

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
 * on a floored `differenceInYears` integer.
 *
 * An earlier version of this module computed `differenceInYears(now,
 * marriageDate)` and compared that floored integer against the policy's N
 * via the generic gte/lte/gt/lt operators. That silently misclassifies real
 * applicants: someone married 1 year 11 months ago has
 * `differenceInYears === 1`, so a floored "<= 1" check would WRONGLY pass a
 * "혼인신고일로부터 1년 이내" ("within 1 year of marriage registration")
 * requirement for someone who is actually 11 months past that cutoff.
 *
 * This version instead compares `marriageDate` directly against an exact
 * calendar cutoff date — `subYears(referenceDate, years)` — using date-fns,
 * which itself handles calendar/leap-year arithmetic correctly (e.g.
 * subtracting 1 year from Feb 29 lands on Feb 28 of a non-leap year). Greater
 * elapsed duration corresponds to an EARLIER marriage date, so the boundary
 * direction inverts relative to the duration-in-years reading:
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
  referenceDate: Date = getNow()
): "pass" | "fail" | "unknown" {
  if (!marriageDate) return "unknown";
  const parsed = parseISO(marriageDate);
  if (!isValid(parsed)) return "unknown";
  if (parsed > referenceDate) return "unknown";

  const cutoff = subYears(referenceDate, spec.years);
  switch (spec.boundary) {
    case "lte":
      return parsed >= cutoff ? "pass" : "fail";
    case "lt":
      return parsed > cutoff ? "pass" : "fail";
    case "gte":
      return parsed <= cutoff ? "pass" : "fail";
    case "gt":
      return parsed < cutoff ? "pass" : "fail";
    default:
      return "unknown";
  }
}
