import { differenceInYears, isValid, parseISO } from "date-fns";
import { getNow } from "@/lib/dates/now";

/**
 * Returns full years elapsed since the applicant's marriage registration
 * date (혼인신고일), as of `referenceDate` (defaults to now).
 *
 * Added for Phase 2 (marital/family eligibility): real MOIS "신혼부부"
 * clauses define their OWN duration threshold per policy (observed real
 * thresholds: 6 months, 1/2/3/5/7 years — no single convention), so this
 * never hardcodes a threshold itself — it just turns a marriage date into a
 * comparable number of years, the same way `calculateAge` turns a birth date
 * into a comparable age, so the existing `gte`/`lte`/`gt`/`lt` rule
 * operators can express each policy's own threshold exactly (see
 * `koreanEligibilityParser.ts`'s `parseMarriageDurationClause` and
 * `fieldResolver.ts`'s `marriageDurationYears` derived field).
 *
 * Returns null for missing, malformed, or future marriage dates rather than
 * throwing, so callers can treat marriage duration as "unknown" instead of
 * crashing or silently producing a nonsensical negative duration.
 */
export function calculateMarriageDurationYears(
  marriageDate: string | undefined,
  referenceDate: Date = getNow()
): number | null {
  if (!marriageDate) return null;
  const parsed = parseISO(marriageDate);
  if (!isValid(parsed)) return null;
  if (parsed > referenceDate) return null;
  const years = differenceInYears(referenceDate, parsed);
  if (years < 0 || years > 100) return null;
  return years;
}
