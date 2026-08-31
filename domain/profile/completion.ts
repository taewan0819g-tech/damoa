import type { UserProfile } from "@/types/profile";

const TRACKED_FIELDS: (keyof UserProfile)[] = [
  "birthDate",
  "residence",
  "maritalStatus",
  "childrenCount",
  "householdSize",
  "employmentStatus",
  "educationStatus",
  "annualIndividualIncome",
  "annualHouseholdIncome",
  "housingType",
  "financialAssets",
  "interests",
];

/**
 * Share of tracked profile fields the user has filled in, as a 0-100 integer.
 * This is purely an input-completeness measure, not a benefit match score.
 */
export function calculateProfileCompletion(profile: UserProfile): number {
  const filled = TRACKED_FIELDS.filter((field) => {
    const value = profile[field];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.values(value).some((v) => v !== undefined && v !== "");
    return true;
  }).length;

  return Math.round((filled / TRACKED_FIELDS.length) * 100);
}
