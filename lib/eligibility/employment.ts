import type { EmploymentStatus } from "@/types/profile";
import { matchStatusCompat, type StatusCompatSpec as GenericStatusCompatSpec } from "./statusCompat";

/**
 * Employment-status compatibility (section 11 of the constraint-compatibility
 * spec): `EmploymentStatus` is a small fixed enum, but several of its real
 * values are genuinely ambiguous against common Korean eligibility phrasing.
 * "미취업" (not employed) and "재직" (currently employed) map confidently onto
 * exactly one enum value each; a naive `eq` comparison, though, would also
 * silently force every OTHER enum value into a wrong pass/fail:
 *   - `freelancer` vs a "미취업" requirement: a freelancer is not a
 *     traditional 재직자, but they're also not unambiguously "미취업" in the
 *     way the policy author meant (freelance income might disqualify them
 *     just like employment would) — genuinely unknown, not a guess either
 *     way.
 *   - `self_employed` / `student` / `other` vs either target: same
 *     ambiguity — never modeled here, so they stay unknown.
 * Only `unemployed` and `employed` are confidently known to satisfy or
 * violate each target; everything else resolves to "unknown" rather than
 * being forced into an incorrect pass or fail.
 *
 * The generic PASS/FAIL/UNKNOWN matching logic itself now lives in
 * `lib/eligibility/statusCompat.ts` (promoted there in Phase 4-B so
 * `maritalStatus`/`educationStatus` compatibility, needed for the Youth
 * Center codebook integration, can reuse it without depending on this
 * employment-specific module). `StatusCompatSpec`/`matchStatusCompat` are
 * re-exported here unchanged so this file's existing 4 call sites
 * (`ruleEngine.ts`, `koreanEligibilityParser.ts`, and their tests) don't
 * need to change.
 */
export type StatusCompatSpec = GenericStatusCompatSpec<EmploymentStatus>;

export type EmploymentTarget = "unemployed" | "employed";

export const EMPLOYMENT_TARGET_SPECS: Record<EmploymentTarget, StatusCompatSpec> = {
  // "미취업자" (must not be employed).
  unemployed: { passValues: ["unemployed"], failValues: ["employed"] },
  // "재직자" (must be currently employed).
  employed: { passValues: ["employed"], failValues: ["unemployed"] },
};

export { matchStatusCompat };
