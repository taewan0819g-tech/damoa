import { describe, expect, it } from "vitest";
import { evaluateEligibility, evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
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

  describe("hasUnresolvedEligibility", () => {
    it("holds a full pass at unknown when hasUnresolvedEligibility is true, even without eligibilityDataStatus: 'incomplete'", () => {
      const status = evaluateEligibility({ eligibility: ageRule, hasUnresolvedEligibility: true }, profileWithAge(25));
      expect(status).toBe("unknown");
    });

    it("still produces not_eligible on a definitive fail even when hasUnresolvedEligibility is true", () => {
      const status = evaluateEligibility({ eligibility: ageRule, hasUnresolvedEligibility: true }, profileWithAge(60));
      expect(status).toBe("not_eligible");
    });

    it("treats a benefit with zero structured rules but hasUnresolvedEligibility: true as unknown (same as no data)", () => {
      const status = evaluateEligibility({ hasUnresolvedEligibility: true }, {});
      expect(status).toBe("unknown");
    });

    it("does not affect a fully-resolved, non-incomplete benefit when hasUnresolvedEligibility is false/unset", () => {
      const status = evaluateEligibility({ eligibility: ageRule, hasUnresolvedEligibility: false }, profileWithAge(25));
      expect(status).toBe("likely_eligible");
    });
  });
});

describe("evaluateEligibilityDetailed", () => {
  it("reports zero rules and no evidence for a benefit with no eligibility data", () => {
    const diag = evaluateEligibilityDetailed({}, {});
    expect(diag).toEqual({
      status: "unknown",
      totalRules: 0,
      resolvedRules: 0,
      passedRules: 0,
      failedRules: 0,
      hasEvidence: false,
      hasPositiveEvidence: false,
      downgradedFromPass: false,
      passedLeaves: [],
    });
  });

  it("reports hasEvidence: true and downgradedFromPass: true for an incomplete benefit whose rules all pass", () => {
    const diag = evaluateEligibilityDetailed(
      { eligibility: ageRule, eligibilityDataStatus: "incomplete" },
      profileWithAge(25)
    );
    expect(diag.status).toBe("unknown");
    expect(diag.totalRules).toBe(1);
    expect(diag.resolvedRules).toBe(1);
    expect(diag.hasEvidence).toBe(true);
    expect(diag.hasPositiveEvidence).toBe(true); // the one resolved rule actually PASSED
    expect(diag.downgradedFromPass).toBe(true);
  });

  it("reports hasEvidence: false when the required field is missing (nothing was actually compared)", () => {
    const diag = evaluateEligibilityDetailed({ eligibility: ageRule }, {});
    expect(diag.status).toBe("unknown");
    expect(diag.totalRules).toBe(1);
    expect(diag.resolvedRules).toBe(0);
    expect(diag.hasEvidence).toBe(false);
    expect(diag.hasPositiveEvidence).toBe(false);
    expect(diag.downgradedFromPass).toBe(false);
  });

  it("reports downgradedFromPass: false for a normal (non-incomplete) pass", () => {
    const diag = evaluateEligibilityDetailed({ eligibility: ageRule }, profileWithAge(25));
    expect(diag.status).toBe("likely_eligible");
    expect(diag.downgradedFromPass).toBe(false);
    expect(diag.hasEvidence).toBe(true);
    expect(diag.hasPositiveEvidence).toBe(true);
  });

  it("counts resolved rules across a multi-rule group with mixed evidence", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "income", field: "annualIndividualIncome", operator: "lte", value: 30000000, required: true },
      ],
    };
    const diag = evaluateEligibilityDetailed({ eligibility: group }, profileWithAge(25));
    expect(diag.totalRules).toBe(2);
    expect(diag.resolvedRules).toBe(1); // age resolved (pass), income unresolved (missing field)
    expect(diag.hasEvidence).toBe(true);
    expect(diag.hasPositiveEvidence).toBe(true); // age resolved to a PASS
    expect(diag.status).toBe("unknown"); // required income field missing
  });

  it("reports hasEvidence: true but hasPositiveEvidence: false when the only resolved rule FAILED", () => {
    // A required rule that definitively fails makes the whole benefit
    // not_eligible, but this still exercises the diagnostic distinction:
    // something was compared (hasEvidence), yet it never PASSED
    // (hasPositiveEvidence) — the correct signal for personalization gating.
    const diag = evaluateEligibilityDetailed({ eligibility: ageRule }, profileWithAge(99));
    expect(diag.status).toBe("not_eligible");
    expect(diag.hasEvidence).toBe(true);
    expect(diag.hasPositiveEvidence).toBe(false);
  });
});
