import { describe, expect, it } from "vitest";
import { normalizeHomeownerConsistency } from "@/domain/profile/homeownerConsistency";
import { parseUserProfile } from "@/lib/validation/profileSchema";

/**
 * `normalizeHomeownerConsistency` is the single place the ONE-WAY
 * housingType -> homeowner inference rule lives: `housingType === "own"`
 * ("자가") is a sufficient positive ownership signal and safely implies
 * `homeowner: true`, but no other `housingType` value may ever be used to
 * infer `homeowner: false` (non-own tenure at the CURRENT residence proves
 * nothing about ownership of property in general). See
 * domain/profile/homeownerConsistency.ts's own doc comment.
 */
describe("normalizeHomeownerConsistency", () => {
  it("housingType own + homeowner undefined -> forces homeowner true", () => {
    expect(normalizeHomeownerConsistency({ housingType: "own" })).toEqual({
      housingType: "own",
      homeowner: true,
    });
  });

  it("housingType own + homeowner explicitly false -> corrected to true (contradiction fixed)", () => {
    expect(normalizeHomeownerConsistency({ housingType: "own", homeowner: false })).toEqual({
      housingType: "own",
      homeowner: true,
    });
  });

  it("housingType own + homeowner already true -> left unchanged (same object identity not required, but value stays true)", () => {
    expect(normalizeHomeownerConsistency({ housingType: "own", homeowner: true })).toEqual({
      housingType: "own",
      homeowner: true,
    });
  });

  it.each(["jeonse", "monthly_rent", "living_with_family", "other"] as const)(
    "housingType %s never forces homeowner to false, even when homeowner is currently true",
    (housingType) => {
      expect(normalizeHomeownerConsistency({ housingType, homeowner: true })).toEqual({
        housingType,
        homeowner: true,
      });
    }
  );

  it.each(["jeonse", "monthly_rent", "living_with_family", "other"] as const)(
    "housingType %s leaves an undefined homeowner untouched (never guessed false)",
    (housingType) => {
      expect(normalizeHomeownerConsistency({ housingType, homeowner: undefined })).toEqual({
        housingType,
        homeowner: undefined,
      });
    }
  );

  it("no housingType at all -> homeowner untouched in every state", () => {
    expect(normalizeHomeownerConsistency({ homeowner: true })).toEqual({ homeowner: true });
    expect(normalizeHomeownerConsistency({ homeowner: false })).toEqual({ homeowner: false });
    expect(normalizeHomeownerConsistency({})).toEqual({});
  });

  it("preserves other fields on the profile unrelated to housingType/homeowner", () => {
    expect(
      normalizeHomeownerConsistency({ housingType: "own", homeowner: false, childrenCount: 2 })
    ).toEqual({ housingType: "own", homeowner: true, childrenCount: 2 });
  });
});

/**
 * `parseUserProfile` (the server-side / externally-supplied-profile
 * boundary, e.g. app/api/benefits/match's request body) applies the same
 * normalization via `userProfileSchema`'s `.transform()`, so a contradictory
 * profile can never be accepted even from a caller that doesn't go through
 * any of this app's own UI write paths.
 */
describe("parseUserProfile normalizes contradictory housingType/homeowner input", () => {
  it("externally-supplied { housingType: 'own', homeowner: false } is corrected to homeowner: true", () => {
    const result = parseUserProfile({ housingType: "own", homeowner: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.housingType).toBe("own");
      expect(result.data.homeowner).toBe(true);
    }
  });

  it("externally-supplied { housingType: 'own' } with homeowner omitted also gets homeowner: true", () => {
    const result = parseUserProfile({ housingType: "own" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.homeowner).toBe(true);
    }
  });

  it("externally-supplied { housingType: 'jeonse', homeowner: true } is left as-is (not overwritten to false)", () => {
    const result = parseUserProfile({ housingType: "jeonse", homeowner: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.housingType).toBe("jeonse");
      expect(result.data.homeowner).toBe(true);
    }
  });

  it("externally-supplied { housingType: 'jeonse' } with homeowner omitted stays undefined, not guessed false", () => {
    const result = parseUserProfile({ housingType: "jeonse" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.homeowner).toBeUndefined();
    }
  });
});
