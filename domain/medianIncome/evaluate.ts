import type { UserProfile } from "@/types/profile";
import { getNow } from "@/lib/dates/now";
import { policyDateString } from "@/lib/dates/policyDate";
import { resolveProfileField } from "@/lib/eligibility/fieldResolver";
import { atLeast, atMost, lessThan, moreThan, compareRangeToInterval, type Interval } from "@/lib/eligibility/interval";
import { getMedianIncomeMonthlyAmount, resolvePolicyCurrentMedianIncomeYear } from "./table";

/**
 * Boundary word a real "기준중위소득 N% (이상|초과|이하|미만)" clause resolves
 * to — same lte/lt/gte/gt vocabulary as `MarriageDurationBoundary`
 * (domain/profile/marriageDuration.ts) for consistency across the codebase's
 * numeric-threshold operators.
 */
export type MedianIncomeBoundary = "lte" | "lt" | "gte" | "gt";

/**
 * `median_income_threshold` rule value shape. See types/benefit.ts's
 * `RuleOperator` doc comment for the operator-level contract.
 *
 * `incomeMetric` is always `"household_income"` today: the production
 * parser (koreanEligibilityParser.ts) only ever emits this operator for
 * clauses it has proven describe HOUSEHOLD income (가구소득/가구원 기준), never
 * for 개인소득, 소득인정액 (recognized income, which subtracts assets/expenses
 * and is NOT the same figure as raw household income), or health-insurance
 * premium bands — see the parser's `classifyIncomeMetric` for the full
 * disambiguation. Kept as an explicit literal (rather than omitted) so a
 * future second metric can be added without a breaking shape change, and so
 * evidence/debugging output is self-describing.
 */
export type MedianIncomeMetric = "household_income";

export interface MedianIncomeThresholdSpec {
  /** e.g. 50 for "기준중위소득 50%". Always the RAW percent number, never pre-divided. */
  percent: number;
  boundary: MedianIncomeBoundary;
  incomeMetric: MedianIncomeMetric;
  /**
   * "scales_with_profile_household" (the overwhelmingly common real shape —
   * no explicit household-size number in the source clause, so the
   * threshold applies to the APPLICANT's own household size, i.e.
   * `profile.householdSize`) vs "fixed_reference_household" (the source
   * clause names one specific household size regardless of the applicant's
   * real household, e.g. a table clause anchored to "4인 가구 기준" — see
   * `fixedHouseholdSize`).
   */
  householdSizeMode: "scales_with_profile_household" | "fixed_reference_household";
  /** Required and only meaningful when `householdSizeMode === "fixed_reference_household"`. */
  fixedHouseholdSize?: number;
  /**
   * Explicit year the source text names (e.g. "2026년 기준 중위소득"), if any.
   * `undefined` means the clause didn't name a year — resolved at
   * EVALUATION time (never parse time) to the policy-current year via
   * `resolvePolicyCurrentMedianIncomeYear`, mirroring
   * `compareMarriageDurationToThreshold`'s reference-date-at-evaluation-time
   * convention so the same stored rule stays correct as calendar years roll
   * over without needing re-extraction.
   */
  year?: number;
}

/**
 * Evaluates a `median_income_threshold` rule against a profile.
 *
 * Semantics (never guesses; every missing-data path returns "unknown"):
 *  1. Resolve the household size to compare against: `fixedHouseholdSize`
 *     for a fixed-reference clause, else `profile.householdSize`. Missing
 *     -> unknown.
 *  2. Resolve the table year: `spec.year` if the clause named one, else the
 *     policy-current year as of `referenceInstant`. No applicable table year
 *     -> unknown.
 *  3. Look up that year/size's verified monthly 기준중위소득 (100%) from the
 *     static table (domain/medianIncome/table.ts). Unverified for that
 *     year/size (e.g. 2027's 8-person figure) -> unknown, NEVER
 *     extrapolated ad hoc here.
 *  4. threshold = monthlyAmount * (percent / 100) * 12 — converted to ANNUAL
 *     KRW because every profile income field
 *     (`annualHouseholdIncome`/`householdIncomeBand`) is annual; 기준중위소득
 *     source figures are always monthly.
 *  5. Resolve the applicant's household income range via the same
 *     `householdIncomeRange` derived field the rest of the rule engine uses
 *     (lib/eligibility/fieldResolver.ts) — never re-reads
 *     `annualHouseholdIncome`/`householdIncomeBand` directly, so a future
 *     resolver change (e.g. a new income-band shape) can't silently diverge
 *     between this operator and every other income rule. Missing -> unknown.
 *  6. Compare via `compareRangeToInterval` (lib/eligibility/interval.ts) —
 *     the single shared range-vs-interval compatibility model used by
 *     `range_within_interval` too, so a straddling range correctly resolves
 *     to "unknown" rather than being forced to a guess.
 */
export function compareHouseholdIncomeToMedianIncomeThreshold(
  profile: UserProfile,
  spec: MedianIncomeThresholdSpec,
  referenceInstant: Date = getNow()
): "pass" | "fail" | "unknown" {
  const householdSize =
    spec.householdSizeMode === "fixed_reference_household" ? spec.fixedHouseholdSize : profile.householdSize;
  if (householdSize === undefined || !Number.isInteger(householdSize) || householdSize < 1) return "unknown";

  const year = spec.year ?? resolvePolicyCurrentMedianIncomeYear(policyDateString(referenceInstant));
  if (year === undefined) return "unknown";

  const monthlyAmount = getMedianIncomeMonthlyAmount(year, householdSize);
  if (monthlyAmount === undefined) return "unknown";

  if (typeof spec.percent !== "number" || spec.percent <= 0) return "unknown";
  const thresholdAnnual = monthlyAmount * (spec.percent / 100) * 12;

  const interval = boundaryToInterval(spec.boundary, thresholdAnnual);
  if (!interval) return "unknown";

  const householdIncomeRange = resolveProfileField(profile, "householdIncomeRange");
  if (
    typeof householdIncomeRange !== "object" ||
    householdIncomeRange === null ||
    typeof (householdIncomeRange as { min?: unknown }).min !== "number" ||
    typeof (householdIncomeRange as { max?: unknown }).max !== "number"
  ) {
    return "unknown";
  }

  return compareRangeToInterval(householdIncomeRange as { min: number; max: number }, interval);
}

function boundaryToInterval(boundary: MedianIncomeBoundary, threshold: number): Interval | undefined {
  switch (boundary) {
    case "lte":
      return atMost(threshold);
    case "lt":
      return lessThan(threshold);
    case "gte":
      return atLeast(threshold);
    case "gt":
      return moreThan(threshold);
    default:
      return undefined;
  }
}
