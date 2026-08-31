import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "@/lib/eligibility/ruleEngine";
import type { EligibilityRuleGroup } from "@/types/benefit";

function group(rules: EligibilityRuleGroup["rules"]): EligibilityRuleGroup {
  return { type: "all", rules };
}

describe("other profile conditions", () => {
  it("matches employment status against an allowed enum list (OR via 'in')", () => {
    const rule = group([
      { id: "employment", field: "employmentStatus", operator: "in", value: ["employed", "self_employed"], required: true },
    ]);
    expect(evaluateEligibility({ eligibility: rule }, { employmentStatus: "employed" })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { employmentStatus: "student" })).toBe("not_eligible");
  });

  it("resolves to unknown when employmentStatus is missing from the profile", () => {
    const rule = group([{ id: "employment", field: "employmentStatus", operator: "in", value: ["employed"], required: true }]);
    expect(evaluateEligibility({ eligibility: rule }, {})).toBe("unknown");
  });

  it("matches education status by exact equality", () => {
    const rule = group([{ id: "education", field: "educationStatus", operator: "eq", value: "university", required: true }]);
    expect(evaluateEligibility({ eligibility: rule }, { educationStatus: "university" })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { educationStatus: "graduated" })).toBe("not_eligible");
  });

  it("matches marital status by exact equality", () => {
    const rule = group([{ id: "marital", field: "maritalStatus", operator: "eq", value: "single", required: true }]);
    expect(evaluateEligibility({ eligibility: rule }, { maritalStatus: "single" })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { maritalStatus: "married" })).toBe("not_eligible");
  });

  it("matches a children-count threshold (childrenCount >= N)", () => {
    const rule = group([{ id: "children", field: "childrenCount", operator: "gte", value: 2, required: true }]);
    expect(evaluateEligibility({ eligibility: rule }, { childrenCount: 3 })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { childrenCount: 1 })).toBe("not_eligible");
  });

  it("matches a homeowner boolean condition without inferring it from housingType", () => {
    const rule = group([{ id: "homeowner", field: "homeowner", operator: "eq", value: true, required: true }]);
    // housingType is "own" but homeowner isn't explicitly set — must NOT be inferred as true.
    expect(evaluateEligibility({ eligibility: rule }, { housingType: "own" })).toBe("unknown");
    expect(evaluateEligibility({ eligibility: rule }, { housingType: "own", homeowner: true })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { homeowner: false })).toBe("not_eligible");
  });

  it("matches housing type against an allowed enum list", () => {
    const rule = group([
      { id: "housing", field: "housingType", operator: "in", value: ["jeonse", "monthly_rent"], required: true },
    ]);
    expect(evaluateEligibility({ eligibility: rule }, { housingType: "jeonse" })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { housingType: "own" })).toBe("not_eligible");
  });

  it("matches a businessOwner boolean condition", () => {
    const rule = group([{ id: "business", field: "businessOwner", operator: "eq", value: true, required: true }]);
    expect(evaluateEligibility({ eligibility: rule }, { businessOwner: true })).toBe("likely_eligible");
    expect(evaluateEligibility({ eligibility: rule }, { businessOwner: false })).toBe("not_eligible");
    expect(evaluateEligibility({ eligibility: rule }, {})).toBe("unknown");
  });
});
