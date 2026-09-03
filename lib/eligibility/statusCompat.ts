/**
 * Generic small-enum applicant-status compatibility model backing the
 * `status_compat` `RuleOperator` (see types/benefit.ts's doc comment on that
 * operator for the full contract).
 *
 * Originally this lived only in `lib/eligibility/employment.ts`, typed
 * specifically to `EmploymentStatus[]`. Phase 4-B (Youth Center codebook
 * production integration) needed the exact same tri-state PASS/FAIL/UNKNOWN
 * shape for `maritalStatus` and `educationStatus` too. Rather than making
 * those domains import from `employment.ts` (which would be semantically
 * backwards — marital/education compatibility has nothing to do with
 * employment), the generic logic now lives here, string-enum-generic over
 * `T extends string`. `employment.ts` re-exports from this module so its
 * existing 4 call sites (`ruleEngine.ts`, `koreanEligibilityParser.ts`, and
 * their tests) keep working unchanged — see that file's own comment.
 *
 * Runtime semantics are unchanged from the original `employment.ts`
 * implementation: `matchStatusCompat` only ever inspects `fieldValue` as a
 * string and does membership tests against `spec.passValues`/
 * `spec.failValues` — it was already string-based at runtime even when
 * TS-typed as `EmploymentStatus[]`, so generalizing the type parameter is a
 * pure type-level change with zero behavior difference for existing callers.
 */
export interface StatusCompatSpec<T extends string = string> {
  passValues: T[];
  failValues: T[];
}

export function matchStatusCompat<T extends string = string>(
  fieldValue: unknown,
  spec: StatusCompatSpec<T>
): "pass" | "fail" | "unknown" {
  if (typeof fieldValue !== "string") return "unknown";
  if ((spec.passValues as string[]).includes(fieldValue)) return "pass";
  if ((spec.failValues as string[]).includes(fieldValue)) return "fail";
  return "unknown";
}

/**
 * Duck-typing guard mirroring `candidateIndex.ts`'s private
 * `isStatusCompatSpec` (kept independent/duplicated there deliberately —
 * see that file — this exported copy exists so other modules, e.g.
 * `domain/youthCodebook/compatibility.ts`, can validate a composed spec
 * without reaching into `candidateIndex.ts`'s internals).
 */
export function isStatusCompatSpec(value: unknown): value is StatusCompatSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { passValues?: unknown }).passValues) &&
    Array.isArray((value as { failValues?: unknown }).failValues)
  );
}
