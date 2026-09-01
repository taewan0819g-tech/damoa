import type { EmploymentStatus } from "@/types/profile";

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
 */
export interface StatusCompatSpec {
  /** Profile values that are verified compatible with (satisfy) the target. */
  passValues: EmploymentStatus[];
  /** Profile values that are verified incompatible with (violate) the target. */
  failValues: EmploymentStatus[];
}

export type EmploymentTarget = "unemployed" | "employed";

export const EMPLOYMENT_TARGET_SPECS: Record<EmploymentTarget, StatusCompatSpec> = {
  // "미취업자" (must not be employed).
  unemployed: { passValues: ["unemployed"], failValues: ["employed"] },
  // "재직자" (must be currently employed).
  employed: { passValues: ["employed"], failValues: ["unemployed"] },
};

/**
 * Generic small-enum compatibility check, shared by both candidate
 * retrieval (via evaluateRule -> compare, see ruleEngine.ts) and the final
 * rule engine — the exact same function, so semantics can't drift between
 * the two stages. Anything not explicitly listed in either side of the spec
 * resolves to "unknown", never a guessed pass or fail.
 */
export function matchStatusCompat(fieldValue: unknown, spec: StatusCompatSpec): "pass" | "fail" | "unknown" {
  if (typeof fieldValue !== "string") return "unknown";
  if ((spec.passValues as string[]).includes(fieldValue)) return "pass";
  if ((spec.failValues as string[]).includes(fieldValue)) return "fail";
  return "unknown";
}
