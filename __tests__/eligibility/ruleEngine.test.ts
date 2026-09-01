import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "@/lib/eligibility/ruleEngine";
import type { Benefit, EligibilityRuleGroup } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

const ageBetween19And34: EligibilityRuleGroup = {
  type: "all",
  rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
};

function makeBenefit(overrides: Partial<Pick<Benefit, "eligibility" | "eligibilityUnrestricted">>) {
  return overrides;
}

function profileWithAge(age: number): UserProfile {
  const now = new Date();
  const birthYear = now.getFullYear() - age;
  return { birthDate: `${birthYear}-01-01` };
}

describe("evaluateEligibility", () => {
  it("returns unknown for a benefit with no eligibility rules and no unrestricted flag (the core bug fix)", () => {
    const status = evaluateEligibility(makeBenefit({}), {});
    expect(status).toBe("unknown");
  });

  it("returns likely_eligible for a benefit explicitly flagged eligibilityUnrestricted", () => {
    const status = evaluateEligibility(makeBenefit({ eligibilityUnrestricted: true }), {});
    expect(status).toBe("likely_eligible");
  });

  it("ignores eligibilityUnrestricted when structured eligibility rules are present", () => {
    const status = evaluateEligibility(
      makeBenefit({ eligibility: ageBetween19And34, eligibilityUnrestricted: true }),
      profileWithAge(50)
    );
    expect(status).toBe("not_eligible");
  });

  it("returns likely_eligible when profile satisfies all required rules", () => {
    const status = evaluateEligibility(makeBenefit({ eligibility: ageBetween19And34 }), profileWithAge(25));
    expect(status).toBe("likely_eligible");
  });

  it("returns not_eligible when profile fails a required rule", () => {
    const status = evaluateEligibility(makeBenefit({ eligibility: ageBetween19And34 }), profileWithAge(50));
    expect(status).toBe("not_eligible");
  });

  it("returns unknown when a required field is missing from the profile", () => {
    const status = evaluateEligibility(makeBenefit({ eligibility: ageBetween19And34 }), {});
    expect(status).toBe("unknown");
  });

  it("skips a non-required rule when the field is missing, instead of marking unknown", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "optional-income", field: "annualIndividualIncome", operator: "lte", value: 30000000, required: false },
      ],
    };
    const status = evaluateEligibility(makeBenefit({ eligibility: group }), profileWithAge(25));
    expect(status).toBe("likely_eligible");
  });

  it("resolves an 'any' group as pass if at least one branch passes", () => {
    const group: EligibilityRuleGroup = {
      type: "any",
      rules: [
        { id: "a", field: "age", operator: "between", value: [0, 10], required: true },
        { id: "b", field: "age", operator: "between", value: [19, 34], required: true },
      ],
    };
    const status = evaluateEligibility(makeBenefit({ eligibility: group }), profileWithAge(25));
    expect(status).toBe("likely_eligible");
  });

  it("resolves a nested rule group", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        {
          type: "any",
          rules: [
            { id: "income-low", field: "annualIndividualIncome", operator: "lte", value: 30000000, required: true },
          ],
        },
      ],
    };
    const eligible = evaluateEligibility(
      makeBenefit({ eligibility: group }),
      { ...profileWithAge(25), annualIndividualIncome: 20000000 }
    );
    expect(eligible).toBe("likely_eligible");

    const ineligible = evaluateEligibility(
      makeBenefit({ eligibility: group }),
      { ...profileWithAge(25), annualIndividualIncome: 90000000 }
    );
    expect(ineligible).toBe("not_eligible");
  });

  it("evaluates strict 'gt' (초과) correctly, unlike 'gte'", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "gt", field: "childrenCount", operator: "gt", value: 2, required: true }],
    };
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), { childrenCount: 3 })).toBe("likely_eligible");
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), { childrenCount: 2 })).toBe("not_eligible");
  });

  it("evaluates strict 'lt' (미만) correctly, unlike 'lte'", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "lt", field: "childrenCount", operator: "lt", value: 2, required: true }],
    };
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), { childrenCount: 1 })).toBe("likely_eligible");
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), { childrenCount: 2 })).toBe("not_eligible");
  });

  it("evaluates target_scope_in against the whole profile, ignoring `field`", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [
        {
          id: "scope",
          field: "사용자구분",
          operator: "target_scope_in",
          value: ["small_business_owner"],
          required: true,
        },
      ],
    };
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), { businessOwner: true })).toBe(
      "likely_eligible"
    );
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), { businessOwner: false })).toBe("not_eligible");
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), {})).toBe("unknown");
  });

  it("target_scope_in always passes for 개인/가구 regardless of profile completeness", () => {
    const group: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "scope", field: "사용자구분", operator: "target_scope_in", value: ["individual"], required: true },
      ],
    };
    expect(evaluateEligibility(makeBenefit({ eligibility: group }), {})).toBe("likely_eligible");
  });
});
