import type { UserProfile } from "@/types/profile";
import { calculateAge } from "@/domain/profile/age";
import { incomeBandToRange } from "@/lib/constants/incomeBands";

/**
 * Resolves a rule "field" string against a UserProfile. Supports derived
 * fields ("age" computed from birthDate; "individualIncomeRange" /
 * "householdIncomeRange" computed from the UI income band, falling back to
 * the legacy exact-income scalar as a degenerate {min: x, max: x} range)
 * plus dot-paths into nested profile objects (e.g. "residence.province").
 * Returns undefined for anything the user hasn't provided yet, which the
 * rule engine treats as unknown data.
 *
 * Note: "marriageDate" is intentionally NOT a derived field here — it
 * resolves via the generic dot-path fallback below, returning the raw ISO
 * string as-is. Marriage-DURATION rules (e.g. "혼인신고일로부터 1년 이내")
 * compare that raw date against an exact calendar cutoff via the
 * `marriage_duration_within` operator (see ruleEngine.ts's `compare()` and
 * domain/profile/marriageDuration.ts) rather than resolving a pre-computed
 * floored year count — a floored integer can silently misclassify someone
 * married 1 year 11 months as "within 1 year".
 */
export function resolveProfileField(profile: UserProfile, field: string): unknown {
  if (field === "age") {
    return calculateAge(profile.birthDate) ?? undefined;
  }

  if (field === "individualIncomeRange") {
    return (
      incomeBandToRange(profile.individualIncomeBand) ??
      (profile.annualIndividualIncome !== undefined
        ? { min: profile.annualIndividualIncome, max: profile.annualIndividualIncome }
        : undefined)
    );
  }

  if (field === "householdIncomeRange") {
    return (
      incomeBandToRange(profile.householdIncomeBand) ??
      (profile.annualHouseholdIncome !== undefined
        ? { min: profile.annualHouseholdIncome, max: profile.annualHouseholdIncome }
        : undefined)
    );
  }

  const parts = field.split(".");
  let current: unknown = profile;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
