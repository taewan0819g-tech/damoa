import { describe, expect, it } from "vitest";
import { EMPLOYMENT_TARGET_SPECS, matchStatusCompat } from "@/lib/eligibility/employment";

/**
 * Section 11/25 of the constraint-compatibility spec: employment-status
 * compatibility must be conservative. "미취업자" (unemployed-required)
 * policies must confidently PASS an unemployed applicant and FAIL an
 * employed one — but must NOT guess for anything else in the enum
 * (freelancer, self_employed, student, other), since none of those are
 * unambiguously "미취업" or "재직" in the way policy text uses the terms.
 */
describe("matchStatusCompat / EMPLOYMENT_TARGET_SPECS", () => {
  describe("unemployed target (미취업자 requirement)", () => {
    it("passes an unemployed applicant", () => {
      expect(matchStatusCompat("unemployed", EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("pass");
    });

    it("fails an employed applicant", () => {
      expect(matchStatusCompat("employed", EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("fail");
    });

    it("never guesses for a freelancer — resolves to unknown", () => {
      expect(matchStatusCompat("freelancer", EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("unknown");
    });

    it("never guesses for self_employed/student/other — all resolve to unknown", () => {
      expect(matchStatusCompat("self_employed", EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("unknown");
      expect(matchStatusCompat("student", EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("unknown");
      expect(matchStatusCompat("other", EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("unknown");
    });
  });

  describe("employed target (재직자 requirement)", () => {
    it("passes an employed applicant", () => {
      expect(matchStatusCompat("employed", EMPLOYMENT_TARGET_SPECS.employed)).toBe("pass");
    });

    it("fails an unemployed applicant", () => {
      expect(matchStatusCompat("unemployed", EMPLOYMENT_TARGET_SPECS.employed)).toBe("fail");
    });

    it("never guesses for a freelancer — resolves to unknown", () => {
      expect(matchStatusCompat("freelancer", EMPLOYMENT_TARGET_SPECS.employed)).toBe("unknown");
    });
  });

  describe("missing / malformed profile data", () => {
    it("resolves to unknown when the profile field is undefined", () => {
      expect(matchStatusCompat(undefined, EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("unknown");
    });

    it("resolves to unknown for a non-string field value rather than throwing", () => {
      expect(matchStatusCompat(42, EMPLOYMENT_TARGET_SPECS.unemployed)).toBe("unknown");
      expect(matchStatusCompat(null, EMPLOYMENT_TARGET_SPECS.employed)).toBe("unknown");
    });
  });
});
