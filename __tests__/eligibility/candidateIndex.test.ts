import { describe, expect, it } from "vitest";
import { buildCandidateIndex, getCandidateBenefits } from "@/lib/eligibility/candidateIndex";
import type { Benefit, EligibilityRuleGroup } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

function benefit(id: string, overrides: Partial<Benefit> = {}): Benefit {
  return {
    id,
    title: id,
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
    ...overrides,
  };
}

function profileWithAge(age: number, extra: Partial<UserProfile> = {}): UserProfile {
  const birthYear = new Date().getFullYear() - age;
  return { birthDate: `${birthYear}-01-01`, ...extra };
}

describe("buildCandidateIndex", () => {
  it("puts a benefit with no eligibility data at all into 'unconstrained'", () => {
    const b = benefit("no-rules");
    const index = buildCandidateIndex([b]);
    expect(index.unconstrained).toEqual([b]);
    expect(index.constrained).toEqual([]);
  });

  it("puts an eligibilityUnrestricted benefit with no eligibility rules into 'unconstrained'", () => {
    const b = benefit("unrestricted", { eligibilityUnrestricted: true });
    const index = buildCandidateIndex([b]);
    expect(index.unconstrained).toEqual([b]);
  });

  it("classifies a top-level required rule inside an 'all' group as constrained, tagged with the right dimension", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    };
    const b = benefit("age-only", { eligibility });
    const index = buildCandidateIndex([b]);
    expect(index.unconstrained).toEqual([]);
    expect(index.constrained).toHaveLength(1);
    expect(index.constrained[0].benefit).toBe(b);
    expect(index.constrained[0].necessaryRules).toHaveLength(1);
    expect(index.constrained[0].dimensions).toEqual(["age"]);
    expect(index.dimensionCounts.age).toBe(1);
  });

  it("collects necessary rules through nested 'all' groups", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        {
          type: "all",
          rules: [{ id: "income", field: "individualIncomeRange", operator: "range_within", value: [0, 30000000], required: true }],
        },
      ],
    };
    const b = benefit("nested-all", { eligibility });
    const index = buildCandidateIndex([b]);
    expect(index.constrained).toHaveLength(1);
    expect(index.constrained[0].necessaryRules).toHaveLength(2);
    expect(index.constrained[0].dimensions.sort()).toEqual(["age", "income"]);
  });

  it("never treats a rule inside an 'any' (OR) group as necessary, even if required: true", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "any",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "region", field: "residence", operator: "region_in", value: [{ province: "서울특별시" }], required: true },
      ],
    };
    const b = benefit("or-group", { eligibility });
    const index = buildCandidateIndex([b]);
    // Zero necessary rules extracted -> falls back to unconstrained, so it
    // can never be incorrectly pruned even though both branches are
    // individually `required: true`.
    expect(index.unconstrained).toEqual([b]);
    expect(index.constrained).toEqual([]);
  });

  it("does not extract rules nested under an 'any' even when the 'any' itself sits inside an 'all'", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        {
          type: "any",
          rules: [
            { id: "region-a", field: "residence", operator: "region_in", value: [{ province: "서울특별시" }], required: true },
            { id: "region-b", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true },
          ],
        },
      ],
    };
    const b = benefit("mixed", { eligibility });
    const index = buildCandidateIndex([b]);
    expect(index.constrained).toHaveLength(1);
    // Only the age rule (reached purely through "all") is necessary; the
    // two region alternatives inside the "any" are not.
    expect(index.constrained[0].necessaryRules.map((r) => r.id)).toEqual(["age"]);
  });

  it("dimensionCounts covers income/employment/education/housing/business/targetScope/region", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "employment", field: "employmentStatus", operator: "eq", value: "unemployed", required: true },
        { id: "education", field: "educationStatus", operator: "eq", value: "university", required: true },
        { id: "housing", field: "homeowner", operator: "eq", value: false, required: true },
        { id: "business", field: "businessOwner", operator: "eq", value: false, required: true },
        { id: "scope", field: "사용자구분", operator: "target_scope_in", value: ["individual"], required: true },
        { id: "region", field: "residence", operator: "region_in", value: [{ province: "서울특별시" }], required: true },
      ],
    };
    const index = buildCandidateIndex([benefit("all-dims", { eligibility })]);
    expect(index.dimensionCounts).toMatchObject({
      employment: 1,
      education: 1,
      housing: 1,
      business: 1,
      targetScope: 1,
      region: 1,
    });
  });

  it("groups constrained entries by dimension in constrainedByDimension, with a multi-dimension entry appearing under each dimension", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "employment", field: "employmentStatus", operator: "eq", value: "unemployed", required: true },
      ],
    };
    const b = benefit("age-and-employment", { eligibility });
    const index = buildCandidateIndex([b]);

    expect(index.constrainedByDimension.get("age")?.map((e) => e.benefit.id)).toEqual(["age-and-employment"]);
    expect(index.constrainedByDimension.get("employment")?.map((e) => e.benefit.id)).toEqual(["age-and-employment"]);
    expect(index.constrainedByDimension.get("income")).toBeUndefined();
    // Same entry object (not a copy) so the bucket stays consistent with `constrained`.
    expect(index.constrainedByDimension.get("age")?.[0]).toBe(index.constrained[0]);
  });
});

describe("getCandidateBenefits", () => {
  it("keeps an unconstrained benefit as a candidate regardless of profile", () => {
    const b = benefit("no-rules");
    const index = buildCandidateIndex([b]);
    expect(getCandidateBenefits(index, {})).toEqual([b]);
  });

  it("prunes a benefit whose necessary age rule definitely fails", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    };
    const b = benefit("age-19-34", { eligibility });
    const index = buildCandidateIndex([b]);
    const candidates = getCandidateBenefits(index, profileWithAge(60));
    expect(candidates).toEqual([]);
  });

  it("keeps a benefit whose necessary age rule passes", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    };
    const b = benefit("age-19-34", { eligibility });
    const index = buildCandidateIndex([b]);
    const candidates = getCandidateBenefits(index, profileWithAge(25));
    expect(candidates).toEqual([b]);
  });

  it("keeps a benefit whose necessary rule can't resolve (missing profile field) — never prunes on absent data", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    };
    const b = benefit("age-19-34", { eligibility });
    const index = buildCandidateIndex([b]);
    const candidates = getCandidateBenefits(index, {});
    expect(candidates).toEqual([b]);
  });

  it("prunes on a definite region conflict but keeps an unresolved region", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "region", field: "residence", operator: "region_in", value: [{ province: "서울특별시" }], required: true }],
    };
    const b = benefit("seoul-only", { eligibility });
    const index = buildCandidateIndex([b]);

    expect(getCandidateBenefits(index, { residence: { province: "경기도" } })).toEqual([]); // definite conflict
    expect(getCandidateBenefits(index, {})).toEqual([b]); // no residence data at all -> keep
  });

  it("prunes on a fully-disjoint income range but keeps a partially-overlapping or unknown one", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "income", field: "individualIncomeRange", operator: "range_within", value: [0, 35000000], required: true },
      ],
    };
    const b = benefit("low-income-only", { eligibility });
    const index = buildCandidateIndex([b]);

    // Band 50M-70M is entirely above the 0-35M ceiling -> definite fail -> prune.
    expect(getCandidateBenefits(index, { individualIncomeBand: "5000_7000" })).toEqual([]);
    // No income data at all -> can't verify a conflict -> keep.
    expect(getCandidateBenefits(index, {})).toEqual([b]);
  });

  it("prunes only when EVERY necessary rule would need to hold, i.e. prunes if ANY one of several necessary rules definitely fails", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "employment", field: "employmentStatus", operator: "eq", value: "unemployed", required: true },
      ],
    };
    const b = benefit("age-and-employment", { eligibility });
    const index = buildCandidateIndex([b]);

    // Age passes, employment definitely fails (employed, rule wants unemployed) -> prune.
    const profile: UserProfile = { ...profileWithAge(25), employmentStatus: "employed" };
    expect(getCandidateBenefits(index, profile)).toEqual([]);
  });

  it("never prunes a rule that was inside an 'any' group, even on a clear conflict", () => {
    const eligibility: EligibilityRuleGroup = {
      type: "any",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    };
    const b = benefit("or-age", { eligibility });
    const index = buildCandidateIndex([b]);
    // Would definitely fail the rule engine's age check, but since it's
    // inside an "any" it was never extracted as necessary -> not pruned.
    expect(getCandidateBenefits(index, profileWithAge(60))).toEqual([b]);
  });

  it("returns a mix of pruned-out and kept benefits across a larger set, preserving all unconstrained ones", () => {
    const passesAge: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    };
    const failsAge: EligibilityRuleGroup = {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [40, 50], required: true }],
    };
    const b1 = benefit("keep-unconstrained");
    const b2 = benefit("keep-pass-age", { eligibility: passesAge });
    const b3 = benefit("prune-fail-age", { eligibility: failsAge });
    const index = buildCandidateIndex([b1, b2, b3]);

    const candidates = getCandidateBenefits(index, profileWithAge(25));
    expect(candidates.map((b) => b.id).sort()).toEqual(["keep-pass-age", "keep-unconstrained"]);
  });
});
