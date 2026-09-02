import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HOMEOWNER_TRI_STATE_OPTIONS, booleanFromTriState, triStateFromBoolean } from "@/lib/constants/triState";

/**
 * Regression coverage for the Part 6 fix: onboarding used to start
 * `homeowner: false` in `INITIAL_DRAFT` and infer `homeowner: true`
 * whenever `housingType === "own"` — silently treating "not yet answered"
 * as "does not own a home", and guessing ownership from an unrelated field
 * (a person can rent their current residence while owning another
 * property). `homeowner` now uses the exact same tri-state
 * (yes/no/unknown -> true/false/undefined) pattern already proven never to
 * default missing data to `false` for singleParentFamily/multiculturalFamily
 * (see triState.test.ts) — these tests confirm homeowner gets that same
 * guarantee, using its own (differently-worded) option set.
 */
describe("homeowner tri-state (Part 6)", () => {
  it("HOMEOWNER_TRI_STATE_OPTIONS covers yes/no/unknown with homeowner-specific wording", () => {
    expect(HOMEOWNER_TRI_STATE_OPTIONS.map((o) => o.value)).toEqual(["yes", "no", "unknown"]);
    expect(HOMEOWNER_TRI_STATE_OPTIONS.find((o) => o.value === "yes")?.label).toBe("소유하고 있어요");
    expect(HOMEOWNER_TRI_STATE_OPTIONS.find((o) => o.value === "no")?.label).toBe("소유하고 있지 않아요");
    expect(HOMEOWNER_TRI_STATE_OPTIONS.find((o) => o.value === "unknown")?.label).toBe("잘 모르겠어요");
  });

  it('an unanswered homeowner choice ("not yet answered", the INITIAL_DRAFT state) converts to undefined, never false', () => {
    const unanswered: "yes" | "no" | "unknown" | undefined = undefined;
    expect(booleanFromTriState(unanswered)).toBeUndefined();
  });

  it('an explicit "잘 모르겠어요" (unknown) choice also converts to undefined, never false', () => {
    expect(booleanFromTriState("unknown")).toBeUndefined();
  });

  it('"소유하고 있어요" (yes) -> true, "소유하고 있지 않아요" (no) -> false', () => {
    expect(booleanFromTriState("yes")).toBe(true);
    expect(booleanFromTriState("no")).toBe(false);
  });

  it("round-trips an existing persisted profile's explicit true/false without altering it", () => {
    expect(booleanFromTriState(triStateFromBoolean(true))).toBe(true);
    expect(booleanFromTriState(triStateFromBoolean(false))).toBe(false);
    expect(booleanFromTriState(triStateFromBoolean(undefined))).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Structural regression guards: the historical bug was specific source
  // patterns (a hardcoded `homeowner: false` initial default, and inferring
  // homeowner from housingType) that a purely functional test of the
  // tri-state helpers above can't observe by itself. Assert those exact
  // patterns are gone from both editing surfaces.
  // ---------------------------------------------------------------------
  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  }

  it("OnboardingFlow.tsx no longer hardcodes homeowner: false as the initial draft default", () => {
    const source = readSource("components/onboarding/OnboardingFlow.tsx");
    expect(source).not.toMatch(/homeowner:\s*false/);
  });

  it("neither OnboardingFlow.tsx nor profile/page.tsx infer homeowner from housingType anymore", () => {
    const onboarding = readSource("components/onboarding/OnboardingFlow.tsx");
    const profilePage = readSource("app/(app)/profile/page.tsx");
    // The old bug: `homeowner: v === "own" ? true : draft.homeowner` (and the
    // profile-page equivalent keyed on `value`/`profile.homeowner`).
    expect(onboarding).not.toMatch(/===\s*"own"\s*\?\s*true/);
    expect(profilePage).not.toMatch(/===\s*"own"\s*\?\s*true/);
  });
});
