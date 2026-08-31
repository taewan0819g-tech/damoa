import type { UserProfile } from "@/types/profile";
import { calculateAge } from "@/domain/profile/age";

/**
 * Resolves a rule "field" string against a UserProfile. Supports the derived
 * "age" field (computed from birthDate) plus dot-paths into nested profile
 * objects (e.g. "residence.province"). Returns undefined for anything the
 * user hasn't provided yet, which the rule engine treats as unknown data.
 */
export function resolveProfileField(profile: UserProfile, field: string): unknown {
  if (field === "age") {
    return calculateAge(profile.birthDate) ?? undefined;
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
