import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "@/lib/eligibility/ruleEngine";
import type { EligibilityRuleGroup } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * "Eligibility completeness" (CRITICAL FIX #2): a benefit may have real
 * requirements Damoa only partially parsed (e.g. age was structured, but a
 * region/employment/income condition in free text wasn't). Passing only
 * the rules we DID parse must never be promoted to likely_eligible when
 * `eligibilityDataStatus: "incomplete"` — only a definite fail proven from
 * the parsed rules can still produce not_eligible; everything else stays
 * unknown, so missing/unparsed data never silently becomes a false
 * "you're eligible".
 */
const ageRule: EligibilityRuleGroup = {
  type: "all",
  rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
};

function profileWithAge(age: number): UserProfile {
  const birthYear = new Date().getFullYear() - age;
  return { birthDate: `${birthYear}-01-01` };
}

describe("eligibility completeness", () => {
  it("does NOT promote an incomplete benefit to likely_eligible even when all parsed rules pass", () => {
    const status = evaluateEligibility(
      { eligibility: ageRule, eligibilityDataStatus: "incomplete" },
      profileWithAge(25)
    );
    expect(status).toBe("unknown");
  });

  it("still produces not_eligible for an incomplete benefit when a parsed required rule definitively fails", () => {
    const status = evaluateEligibility(
      { eligibility: ageRule, eligibilityDataStatus: "incomplete" },
      profileWithAge(60)
    );
    expect(status).toBe("not_eligible");
  });

  it("resolves to unknown for an incomplete benefit when a parsed required field is missing", () => {
    const status = evaluateEligibility({ eligibility: ageRule, eligibilityDataStatus: "incomplete" }, {});
    expect(status).toBe("unknown");
  });

  it("preserves normal all-pass -> likely_eligible behavior when eligibilityDataStatus is 'complete'", () => {
    const status = evaluateEligibility(
      { eligibility: ageRule, eligibilityDataStatus: "complete" },
      profileWithAge(25)
    );
    expect(status).toBe("likely_eligible");
  });

  it("preserves normal all-pass -> likely_eligible behavior when eligibilityDataStatus is left unset (default)", () => {
    const status = evaluateEligibility({ eligibility: ageRule }, profileWithAge(25));
    expect(status).toBe("likely_eligible");
  });

  it("treats eligibilityDataStatus 'unrestricted' with no rules the same as eligibilityUnrestricted", () => {
    const status = evaluateEligibility({ eligibilityDataStatus: "unrestricted" }, {});
    expect(status).toBe("likely_eligible");
  });

  it("ignores an 'unrestricted' data status when structured rules exist and the profile fails them", () => {
    const status = evaluateEligibility(
      { eligibility: ageRule, eligibilityDataStatus: "unrestricted" },
      profileWithAge(60)
    );
    expect(status).toBe("not_eligible");
  });
});
