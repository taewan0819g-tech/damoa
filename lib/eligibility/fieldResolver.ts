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
