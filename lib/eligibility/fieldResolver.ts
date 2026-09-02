import type { UserProfile } from "@/types/profile";
import { calculateAge } from "@/domain/profile/age";
import { calculateMarriageDurationYears } from "@/domain/profile/marriageDuration";
import { incomeBandToRange } from "@/lib/constants/incomeBands";

/**
 * Resolves a rule "field" string against a UserProfile. Supports derived
 * fields ("age" computed from birthDate; "individualIncomeRange" /
 * "householdIncomeRange" computed from the UI income band, falling back to
 * the legacy exact-income scalar as a degenerate {min: x, max: x} range)
 * plus dot-paths into nested profile objects (e.g. "residence.province").
 * Returns undefined for anything the user hasn't provided yet, which the
 * rule engine treats as unknown data.
 */
export function resolveProfileField(profile: UserProfile, field: string): unknown {
  if (field === "age") {
    return calculateAge(profile.birthDate) ?? undefined;
  }

  /**
   * Derived from `marriageDate` (see Phase 2 audit / `calculateMarriageDurationYears`)
   * so "혼인신고일로부터 N년 이내"-style clauses can be expressed with the
   * plain existing gte/lte/gt/lt operators instead of a bespoke date-diff
   * operator — no unsafe string date arithmetic in the rule itself.
   */
  if (field === "marriageDurationYears") {
    return calculateMarriageDurationYears(profile.marriageDate) ?? undefined;
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
