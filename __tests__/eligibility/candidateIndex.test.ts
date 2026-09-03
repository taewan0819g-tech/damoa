import { describe, expect, it } from "vitest";
import {
  buildCandidateIndex,
  getCandidateBenefits,
  getCandidateBenefitsFullScan,
  getCandidateBenefitsWithDiagnostics,
} from "@/lib/eligibility/candidateIndex";
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

/** ISO date string `monthsAgo` months before the current wall-clock date — mirrors ruleEngine.test.ts's helper. */
function recentIsoDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
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

/**
 * Deterministic PRNG (mulberry32) so the randomized-profile equivalence
 * sweep below is reproducible across runs/CI rather than flaky.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROVINCES = ["서울특별시", "경기도", "부산광역시", "제주특별자치도"];
const EMPLOYMENT_STATUSES: UserProfile["employmentStatus"][] = [
  "employed",
  "unemployed",
  "self_employed",
  "freelancer",
  "student",
  "other",
];
const EDUCATION_STATUSES: UserProfile["educationStatus"][] = [
  "high_school",
  "university",
  "graduate_school",
  "graduated",
  "not_applicable",
];
const HOUSING_TYPES: UserProfile["housingType"][] = ["own", "jeonse", "monthly_rent", "living_with_family", "other"];
const MARITAL_STATUSES: UserProfile["maritalStatus"][] = ["single", "married", "divorced", "widowed"];
/** Months-ago values spanning missing/recent/exactly-on-threshold/old, for randomized marriageDate coverage against a 1-year newlywed threshold. */
const MARRIAGE_MONTHS_AGO = [3, 6, 11, 12, 13, 24, 36];

/**
 * A large synthetic catalog exercising every dimension and every
 * operator/value shape the indexing layer specifically fast-paths (age
 * between/gte/gt/lte/lt, income range_within / range_within_interval on
 * both individual and household fields, region_in across several
 * provinces, target_scope_in across individual/household/소상공인/법인,
 * employment eq + status_compat, education/housing/business eq, the
 * "family" dimension (maritalStatus eq/status_compat, childrenCount and
 * householdSize gte/lt/between, singleParentFamily/multiculturalFamily eq,
 * marriageDate marriage_duration_within — see checkpoint-3's family index),
 * a genuinely unmodeled field that only classifies as "other", nested
 * all/any combinations, and unconstrained/eligibilityUnrestricted
 * benefits) — used to sweep the optimized (indexed) retrieval path
 * against the full-scan reference implementation for exact equivalence.
 */
function buildSyntheticCatalog(): Benefit[] {
  const benefits: Benefit[] = [];

  benefits.push(benefit("u-no-rules"));
  benefits.push(benefit("u-unrestricted", { eligibilityUnrestricted: true }));

  for (let i = 0; i < 6; i++) {
    const [min, max] = [15 + i * 5, 25 + i * 5];
    benefits.push(
      benefit(`age-between-${i}`, {
        eligibility: { type: "all", rules: [{ id: "age", field: "age", operator: "between", value: [min, max], required: true }] },
      })
    );
  }
  benefits.push(
    benefit("age-gte", { eligibility: { type: "all", rules: [{ id: "age", field: "age", operator: "gte", value: 30, required: true }] } })
  );
  benefits.push(
    benefit("age-gt", { eligibility: { type: "all", rules: [{ id: "age", field: "age", operator: "gt", value: 30, required: true }] } })
  );
  benefits.push(
    benefit("age-lte", { eligibility: { type: "all", rules: [{ id: "age", field: "age", operator: "lte", value: 40, required: true }] } })
  );
  benefits.push(
    benefit("age-lt", { eligibility: { type: "all", rules: [{ id: "age", field: "age", operator: "lt", value: 40, required: true }] } })
  );

  for (let i = 0; i < 5; i++) {
    const ceiling = 20_000_000 + i * 10_000_000;
    benefits.push(
      benefit(`income-range-within-${i}`, {
        eligibility: {
          type: "all",
          rules: [{ id: "income", field: "individualIncomeRange", operator: "range_within", value: [0, ceiling], required: true }],
        },
      })
    );
    benefits.push(
      benefit(`income-household-${i}`, {
        eligibility: {
          type: "all",
          rules: [{ id: "income", field: "householdIncomeRange", operator: "range_within", value: [0, ceiling], required: true }],
        },
      })
    );
  }
  benefits.push(
    benefit("income-strict-interval", {
      eligibility: {
        type: "all",
        rules: [
          {
            id: "income",
            field: "individualIncomeRange",
            operator: "range_within_interval",
            value: { max: 35_000_000, minInclusive: true, maxInclusive: false },
            required: true,
          },
        ],
      },
    })
  );

  for (const province of PROVINCES) {
    benefits.push(
      benefit(`region-${province}`, {
        eligibility: {
          type: "all",
          rules: [{ id: "region", field: "residence", operator: "region_in", value: [{ province }], required: true }],
        },
      })
    );
  }
  benefits.push(
    benefit("region-multi", {
      eligibility: {
        type: "all",
        rules: [
          {
            id: "region",
            field: "residence",
            operator: "region_in",
            value: [{ province: "서울특별시" }, { province: "경기도", city: "성남시" }],
            required: true,
          },
        ],
      },
    })
  );

  benefits.push(
    benefit("scope-individual", {
      eligibility: { type: "all", rules: [{ id: "scope", field: "사용자구분", operator: "target_scope_in", value: ["individual"], required: true }] },
    })
  );
  benefits.push(
    benefit("scope-business-owner", {
      eligibility: {
        type: "all",
        rules: [{ id: "scope", field: "사용자구분", operator: "target_scope_in", value: ["small_business_owner"], required: true }],
      },
    })
  );
  benefits.push(
    benefit("scope-corporate", {
      eligibility: { type: "all", rules: [{ id: "scope", field: "사용자구분", operator: "target_scope_in", value: ["corporate"], required: true }] },
    })
  );

  for (const status of ["unemployed", "employed"] as const) {
    benefits.push(
      benefit(`employment-status-compat-${status}`, {
        eligibility: {
          type: "all",
          rules: [
            {
              id: "employment",
              field: "employmentStatus",
              operator: "status_compat",
              value:
                status === "unemployed"
                  ? { passValues: ["unemployed"], failValues: ["employed"] }
                  : { passValues: ["employed"], failValues: ["unemployed"] },
              required: true,
            },
          ],
        },
      })
    );
  }
  benefits.push(
    benefit("employment-sme-employee", {
      eligibility: { type: "all", rules: [{ id: "sme", field: "smeEmployee", operator: "eq", value: true, required: true }] },
    })
  );

  for (const edu of EDUCATION_STATUSES) {
    benefits.push(
      benefit(`education-${edu}`, {
        eligibility: { type: "all", rules: [{ id: "edu", field: "educationStatus", operator: "eq", value: edu, required: true }] },
      })
    );
  }

  for (const housing of HOUSING_TYPES) {
    benefits.push(
      benefit(`housing-type-${housing}`, {
        eligibility: { type: "all", rules: [{ id: "housing", field: "housingType", operator: "eq", value: housing, required: true }] },
      })
    );
  }
  benefits.push(
    benefit("housing-homeowner-false", {
      eligibility: { type: "all", rules: [{ id: "homeowner", field: "homeowner", operator: "eq", value: false, required: true }] },
    })
  );

  benefits.push(
    benefit("business-owner-true", {
      eligibility: { type: "all", rules: [{ id: "biz", field: "businessOwner", operator: "eq", value: true, required: true }] },
    })
  );
  benefits.push(
    benefit("business-owner-false", {
      eligibility: { type: "all", rules: [{ id: "biz", field: "businessOwner", operator: "eq", value: false, required: true }] },
    })
  );

  // --- family dimension (maritalStatus / childrenCount / householdSize / singleParentFamily / multiculturalFamily / marriageDate) ---
  benefits.push(
    benefit("family-children-gte-2", {
      eligibility: { type: "all", rules: [{ id: "children", field: "childrenCount", operator: "gte", value: 2, required: true }] },
    })
  );
  benefits.push(
    benefit("family-children-lt-1", {
      eligibility: { type: "all", rules: [{ id: "children", field: "childrenCount", operator: "lt", value: 1, required: true }] },
    })
  );
  benefits.push(
    benefit("family-household-between", {
      eligibility: { type: "all", rules: [{ id: "household", field: "householdSize", operator: "between", value: [2, 4], required: true }] },
    })
  );
  for (const status of ["single", "married", "divorced", "widowed"] as const) {
    benefits.push(
      benefit(`family-marital-eq-${status}`, {
        eligibility: { type: "all", rules: [{ id: "marital", field: "maritalStatus", operator: "eq", value: status, required: true }] },
      })
    );
  }
  benefits.push(
    benefit("family-marital-status-compat-married", {
      eligibility: {
        type: "all",
        rules: [
          {
            id: "marital",
            field: "maritalStatus",
            operator: "status_compat",
            value: { passValues: ["married"], failValues: ["single"] },
            required: true,
          },
        ],
      },
    })
  );
  benefits.push(
    benefit("family-single-parent-true", {
      eligibility: { type: "all", rules: [{ id: "sp", field: "singleParentFamily", operator: "eq", value: true, required: true }] },
    })
  );
  benefits.push(
    benefit("family-multicultural-true", {
      eligibility: { type: "all", rules: [{ id: "mc", field: "multiculturalFamily", operator: "eq", value: true, required: true }] },
    })
  );
  benefits.push(
    benefit("family-newlywed-compound", {
      eligibility: {
        type: "all",
        rules: [
          { id: "marital", field: "maritalStatus", operator: "eq", value: "married", required: true },
          {
            id: "duration",
            field: "marriageDate",
            operator: "marriage_duration_within",
            value: { years: 1, boundary: "lte" },
            required: true,
          },
        ],
      },
    })
  );

  // A genuinely unmodeled field — exercises the true "other" catch-all dimension.
  benefits.push(
    benefit("other-unmodeled-field", {
      eligibility: { type: "all", rules: [{ id: "x", field: "someUnmodeledField", operator: "eq", value: "x", required: true }] },
    })
  );

  benefits.push(
    benefit("or-age-region", {
      eligibility: {
        type: "any",
        rules: [
          { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
          { id: "region", field: "residence", operator: "region_in", value: [{ province: "서울특별시" }], required: true },
        ],
      },
    })
  );

  benefits.push(
    benefit("multi-dimension", {
      eligibility: {
        type: "all",
        rules: [
          { id: "age", field: "age", operator: "between", value: [19, 45], required: true },
          { id: "region", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true },
          { id: "employment", field: "employmentStatus", operator: "status_compat", value: { passValues: ["unemployed"], failValues: ["employed"] }, required: true },
          {
            type: "any",
            rules: [
              { id: "edu-a", field: "educationStatus", operator: "eq", value: "university", required: true },
              { id: "edu-b", field: "educationStatus", operator: "eq", value: "graduate_school", required: true },
            ],
          },
        ],
      },
    })
  );

  return benefits;
}

/** A hand-picked spread of profiles from empty to fully-specified, plus a few edge cases (freelancer, unknown income band, region without city, etc.). */
function handPickedProfiles(): UserProfile[] {
  return [
    {},
    profileWithAge(25),
    { ...profileWithAge(60), residence: { province: "서울특별시" } },
    { ...profileWithAge(32), residence: { province: "경기도", city: "성남시" } },
    { ...profileWithAge(28), individualIncomeBand: "2000_3000" },
    { ...profileWithAge(28), householdIncomeBand: "5000_7000" },
    { ...profileWithAge(28), individualIncomeBand: "unknown" },
    { ...profileWithAge(28), employmentStatus: "unemployed" },
    { ...profileWithAge(28), employmentStatus: "employed" },
    { ...profileWithAge(28), employmentStatus: "freelancer" },
    { ...profileWithAge(22), educationStatus: "university" },
    { ...profileWithAge(22), educationStatus: "high_school" },
    { ...profileWithAge(22), housingType: "own", homeowner: true },
    { ...profileWithAge(22), housingType: "jeonse", homeowner: false },
    { businessOwner: true },
    { businessOwner: false },
    { smeEmployee: true },
    { childrenCount: 3 },
    { childrenCount: 0 },
    { childrenCount: 1 },
    { childrenCount: 2 },
    { childrenCount: 4 },
    { householdSize: 1 },
    { householdSize: 2 },
    { householdSize: 3 },
    { householdSize: 4 },
    { householdSize: 5 },
    { maritalStatus: "single" },
    { maritalStatus: "married" },
    { maritalStatus: "divorced" },
    { maritalStatus: "widowed" },
    { singleParentFamily: true },
    { singleParentFamily: false },
    { multiculturalFamily: true },
    { multiculturalFamily: false },
    { marriageDate: recentIsoDate(6) }, // recent — inside a 1-year newlywed window
    { marriageDate: recentIsoDate(36) }, // old — outside a 1-year newlywed window
    { marriageDate: recentIsoDate(12) }, // exactly on a 1-year threshold (boundary)
    { maritalStatus: "married", marriageDate: recentIsoDate(6) }, // newlywed compound: both halves pass
    { maritalStatus: "divorced", marriageDate: recentIsoDate(6) }, // newlywed compound: marital half fails
    { maritalStatus: "married", marriageDate: recentIsoDate(36) }, // newlywed compound: duration half fails
    {
      maritalStatus: "married",
      childrenCount: 2,
      householdSize: 4,
      singleParentFamily: false,
      multiculturalFamily: false,
      marriageDate: recentIsoDate(6),
    },
    {
      ...profileWithAge(29),
      residence: { province: "경기도" },
      employmentStatus: "unemployed",
      educationStatus: "university",
      individualIncomeBand: "2000_3000",
      housingType: "jeonse",
      homeowner: false,
      businessOwner: false,
      childrenCount: 2,
    },
    {
      ...profileWithAge(50),
      residence: { province: "제주특별자치도" },
      employmentStatus: "employed",
      educationStatus: "graduated",
      individualIncomeBand: "over_7000",
      householdIncomeBand: "over_7000",
      housingType: "own",
      homeowner: true,
      businessOwner: true,
      smeEmployee: false,
      childrenCount: 0,
    },
  ];
}

function randomProfiles(count: number, seed: number): UserProfile[] {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const profiles: UserProfile[] = [];
  for (let i = 0; i < count; i++) {
    const p: UserProfile = {};
    if (rand() < 0.7) p.birthDate = `${2026 - Math.floor(rand() * 80)}-01-01`;
    if (rand() < 0.5) p.residence = { province: pick(PROVINCES), city: rand() < 0.5 ? "성남시" : undefined };
    if (rand() < 0.5) p.employmentStatus = pick(EMPLOYMENT_STATUSES);
    if (rand() < 0.5) p.educationStatus = pick(EDUCATION_STATUSES);
    if (rand() < 0.5) p.housingType = pick(HOUSING_TYPES);
    if (rand() < 0.5) p.homeowner = rand() < 0.5;
    if (rand() < 0.5) p.businessOwner = rand() < 0.5;
    if (rand() < 0.4) p.smeEmployee = rand() < 0.5;
    if (rand() < 0.5) {
      const bands = ["none", "under_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_7000", "over_7000", "unknown"] as const;
      p.individualIncomeBand = pick(bands);
    }
    if (rand() < 0.3) {
      const bands = ["none", "under_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_7000", "over_7000", "unknown"] as const;
      p.householdIncomeBand = pick(bands);
    }
    if (rand() < 0.3) p.childrenCount = Math.floor(rand() * 4);
    if (rand() < 0.3) p.householdSize = 1 + Math.floor(rand() * 5);
    if (rand() < 0.5) p.maritalStatus = pick(MARITAL_STATUSES);
    if (rand() < 0.3) p.singleParentFamily = rand() < 0.5;
    if (rand() < 0.3) p.multiculturalFamily = rand() < 0.5;
    if (rand() < 0.4) p.marriageDate = recentIsoDate(pick(MARRIAGE_MONTHS_AGO));
    profiles.push(p);
  }
  return profiles;
}

describe("optimized (indexed) retrieval vs full-scan reference implementation — section 11 equivalence sweep", () => {
  it("returns EXACTLY the same candidate id set as the full-scan reference for a hand-picked spread of profiles (never over-prunes, never under-prunes)", () => {
    const catalog = buildSyntheticCatalog();
    const index = buildCandidateIndex(catalog);
    for (const profile of handPickedProfiles()) {
      const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
      const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
      expect(indexed).toEqual(fullScan);
    }
  });

  it("returns EXACTLY the same candidate id set as the full-scan reference across 300 randomized synthetic profiles (deterministic seed)", () => {
    const catalog = buildSyntheticCatalog();
    const index = buildCandidateIndex(catalog);
    const profiles = randomProfiles(300, 42);
    const mismatches: { profile: UserProfile; indexed: string[]; fullScan: string[] }[] = [];
    for (const profile of profiles) {
      const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
      const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
      if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) {
        mismatches.push({ profile, indexed, fullScan });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("never over-prunes even with a second independent random seed (extra confidence sweep)", () => {
    const catalog = buildSyntheticCatalog();
    const index = buildCandidateIndex(catalog);
    for (const profile of randomProfiles(150, 12345)) {
      const indexed = new Set(getCandidateBenefits(index, profile).map((b) => b.id));
      const fullScan = new Set(getCandidateBenefitsFullScan(index, profile).map((b) => b.id));
      // Every full-scan candidate must still be a candidate in the indexed path (no false negatives).
      for (const id of fullScan) expect(indexed.has(id)).toBe(true);
      // And the indexed path must not admit anything the full scan wouldn't (no false positives either).
      for (const id of indexed) expect(fullScan.has(id)).toBe(true);
    }
  });

  describe("family dimension — full combination equivalence sweep (checkpoint-3 section E)", () => {
    // Exhaustive cartesian product across every value named in the
    // checkpoint-3 spec: maritalStatus (missing/single/married/divorced/
    // widowed), childrenCount (missing/0/1/2/3/4), householdSize
    // (missing/1/2/3/4/5), singleParentFamily (missing/true/false),
    // multiculturalFamily (missing/true/false), marriageDate (missing/
    // recent/exactly-on-threshold/old). For EVERY resulting profile, the
    // optimized (indexed) candidate ID set must exactly equal the full-scan
    // reference set — mismatch count must be ZERO.
    const MARITAL_STATUS_VALUES: (UserProfile["maritalStatus"] | undefined)[] = [
      undefined,
      "single",
      "married",
      "divorced",
      "widowed",
    ];
    const CHILDREN_COUNT_VALUES: (number | undefined)[] = [undefined, 0, 1, 2, 3, 4];
    const HOUSEHOLD_SIZE_VALUES: (number | undefined)[] = [undefined, 1, 2, 3, 4, 5];
    const BOOLEAN_OR_UNKNOWN: (boolean | undefined)[] = [undefined, true, false];
    // "recent" (6mo, inside a 1yr window), "exactly-on-threshold" (12mo,
    // the cutoff itself), "old" (36mo, outside a 1yr window), and missing.
    const MARRIAGE_DATE_VALUES: (string | undefined)[] = [undefined, recentIsoDate(6), recentIsoDate(12), recentIsoDate(36)];

    function* familyCombinations(): Generator<UserProfile> {
      for (const maritalStatus of MARITAL_STATUS_VALUES) {
        for (const childrenCount of CHILDREN_COUNT_VALUES) {
          for (const householdSize of HOUSEHOLD_SIZE_VALUES) {
            for (const singleParentFamily of BOOLEAN_OR_UNKNOWN) {
              for (const multiculturalFamily of BOOLEAN_OR_UNKNOWN) {
                for (const marriageDate of MARRIAGE_DATE_VALUES) {
                  const profile: UserProfile = {};
                  if (maritalStatus !== undefined) profile.maritalStatus = maritalStatus;
                  if (childrenCount !== undefined) profile.childrenCount = childrenCount;
                  if (householdSize !== undefined) profile.householdSize = householdSize;
                  if (singleParentFamily !== undefined) profile.singleParentFamily = singleParentFamily;
                  if (multiculturalFamily !== undefined) profile.multiculturalFamily = multiculturalFamily;
                  if (marriageDate !== undefined) profile.marriageDate = marriageDate;
                  yield profile;
                }
              }
            }
          }
        }
      }
    }

    it("optimized candidate IDs exactly equal full-scan reference IDs for every combination (mismatch count === 0)", () => {
      const catalog = buildSyntheticCatalog();
      const index = buildCandidateIndex(catalog);
      let combinationCount = 0;
      const mismatches: { profile: UserProfile; indexed: string[]; fullScan: string[] }[] = [];
      for (const profile of familyCombinations()) {
        combinationCount += 1;
        const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
        const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
        if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) {
          mismatches.push({ profile, indexed, fullScan });
        }
      }
      // 5 * 6 * 6 * 3 * 3 * 4 = 6480 combinations swept.
      expect(combinationCount).toBe(5 * 6 * 6 * 3 * 3 * 4);
      expect(mismatches.length, `expected ZERO mismatches, found ${mismatches.length}: ${JSON.stringify(mismatches.slice(0, 3))}`).toBe(0);
    });

    it("also holds across the same family combinations layered onto a rich non-family profile (age/region/income/employment known too)", () => {
      const catalog = buildSyntheticCatalog();
      const index = buildCandidateIndex(catalog);
      const richBase: UserProfile = {
        ...profileWithAge(29),
        residence: { province: "경기도" },
        employmentStatus: "unemployed",
        educationStatus: "university",
        individualIncomeBand: "2000_3000",
        housingType: "jeonse",
        homeowner: false,
        businessOwner: false,
      };
      let mismatchCount = 0;
      let checked = 0;
      // Sample every 37th combination (coprime-ish stride) for a fast but
      // still broad independent sweep layered on a fully-populated profile.
      let i = 0;
      for (const familyProfile of familyCombinations()) {
        if (i++ % 37 !== 0) continue;
        checked += 1;
        const profile: UserProfile = { ...richBase, ...familyProfile };
        const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
        const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
        if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) mismatchCount += 1;
      }
      expect(checked).toBeGreaterThan(100);
      expect(mismatchCount).toBe(0);
    });
  });
});

describe("median_income_threshold candidate index (checkpoint-3: incomeKnown fallback-gate fix)", () => {
  // Deliberately a catalog with ONLY median_income_threshold rules for
  // income — NO range_within/range_within_interval income rules at all, so
  // `incomeIndex.byField` stays completely empty (median_income_threshold
  // rules always land in `incomeIndex.fallback`, never `byField` — see
  // `classifyDimension`/`incomeRuleToInterval`). This is the exact shape
  // that exposed the pre-fix bug: `incomeKnown` used to be derived SOLELY
  // from `byField`'s contents, so with an empty `byField` the fallback
  // bucket (containing every median-income rule) was never checked even
  // when the profile's household income was fully known — silently
  // under-pruning and breaking indexed-vs-full-scan equivalence.
  function medianIncomeCatalog(): Benefit[] {
    return [
      benefit("mi-unconstrained"),
      benefit("mi-50-profile-lte", {
        eligibility: {
          type: "all",
          rules: [
            {
              id: "mi",
              field: "householdIncomeRange",
              operator: "median_income_threshold",
              required: true,
              value: {
                percent: 50,
                boundary: "lte",
                incomeMetric: "household_income",
                householdSizeMode: "scales_with_profile_household",
              },
            },
          ],
        },
      }),
      benefit("mi-100-profile-lte", {
        eligibility: {
          type: "all",
          rules: [
            {
              id: "mi",
              field: "householdIncomeRange",
              operator: "median_income_threshold",
              required: true,
              value: {
                percent: 100,
                boundary: "lte",
                incomeMetric: "household_income",
                householdSizeMode: "scales_with_profile_household",
              },
            },
          ],
        },
      }),
      benefit("mi-fixed-4-60-lte", {
        eligibility: {
          type: "all",
          rules: [
            {
              id: "mi",
              field: "householdIncomeRange",
              operator: "median_income_threshold",
              required: true,
              value: {
                percent: 60,
                boundary: "lte",
                incomeMetric: "household_income",
                householdSizeMode: "fixed_reference_household",
                fixedHouseholdSize: 4,
              },
            },
          ],
        },
      }),
      benefit("mi-80-profile-gte", {
        eligibility: {
          type: "all",
          rules: [
            {
              id: "mi",
              field: "householdIncomeRange",
              operator: "median_income_threshold",
              required: true,
              value: {
                percent: 80,
                boundary: "gte",
                incomeMetric: "household_income",
                householdSizeMode: "scales_with_profile_household",
              },
            },
          ],
        },
      }),
      // Compound: also requires age, so a definite median-income FAIL must
      // still prune this benefit via the "all" group (both are required).
      benefit("mi-50-profile-lte-and-age-adult", {
        eligibility: {
          type: "all",
          rules: [
            {
              id: "mi",
              field: "householdIncomeRange",
              operator: "median_income_threshold",
              required: true,
              value: {
                percent: 50,
                boundary: "lte",
                incomeMetric: "household_income",
                householdSizeMode: "scales_with_profile_household",
              },
            },
            { id: "age", field: "age", operator: "gte", value: 19, required: true },
          ],
        },
      }),
    ];
  }

  // 2026 4-person monthly = 6,494,738 KRW (see domain/medianIncome/table.ts)
  // -> 50% annual threshold = 38,968,428; 100% annual threshold = 77,936,856.
  const THRESHOLD_50PCT_4PERSON_2026 = 38968428;

  it("a profile with known household income + size that definitely FAILS a median-income rule is excluded identically by both the indexed and full-scan paths", () => {
    const catalog = medianIncomeCatalog();
    const index = buildCandidateIndex(catalog);
    const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 + 1 };

    const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
    const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();

    expect(indexed).toEqual(fullScan);
    // The core regression assertion: this benefit's required median-income
    // rule definitively fails at this income, so BOTH paths must prune it —
    // pre-fix, the indexed path would have wrongly kept it (empty byField
    // meant the fallback bucket holding this rule was never consulted).
    expect(indexed).not.toContain("mi-50-profile-lte");
    expect(indexed).not.toContain("mi-50-profile-lte-and-age-adult");
  });

  it("a profile that PASSES a median-income rule is kept by both paths", () => {
    const catalog = medianIncomeCatalog();
    const index = buildCandidateIndex(catalog);
    const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026, birthDate: "2000-01-01" };

    const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
    const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();

    expect(indexed).toEqual(fullScan);
    expect(indexed).toContain("mi-50-profile-lte");
    expect(indexed).toContain("mi-50-profile-lte-and-age-adult");
  });

  it("equivalence sweep across household size / income-band / fixed-vs-profile combinations (mismatch count === 0)", () => {
    const catalog = medianIncomeCatalog();
    const index = buildCandidateIndex(catalog);
    const householdSizes: (number | undefined)[] = [undefined, 1, 2, 3, 4, 5, 7];
    const incomeBands: (UserProfile["householdIncomeBand"] | undefined)[] = [
      undefined,
      "none",
      "under_1000",
      "1000_2000",
      "2000_3000",
      "3000_4000",
      "4000_5000",
      "5000_7000",
      "over_7000",
      "unknown",
    ];

    const mismatches: { profile: UserProfile; indexed: string[]; fullScan: string[] }[] = [];
    let combinationCount = 0;
    for (const householdSize of householdSizes) {
      for (const householdIncomeBand of incomeBands) {
        combinationCount += 1;
        const profile: UserProfile = {};
        if (householdSize !== undefined) profile.householdSize = householdSize;
        if (householdIncomeBand !== undefined) profile.householdIncomeBand = householdIncomeBand;

        const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
        const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
        if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) {
          mismatches.push({ profile, indexed, fullScan });
        }
      }
    }
    expect(combinationCount).toBe(householdSizes.length * incomeBands.length);
    expect(mismatches.length, `expected ZERO mismatches, found ${mismatches.length}: ${JSON.stringify(mismatches.slice(0, 3))}`).toBe(0);
  });

  it("median-income benefits added into the FULL synthetic catalog (mixed with range_within/range_within_interval income rules) still hold zero-mismatch equivalence", () => {
    const catalog = [...buildSyntheticCatalog(), ...medianIncomeCatalog()];
    const index = buildCandidateIndex(catalog);
    const mismatches: { profile: UserProfile; indexed: string[]; fullScan: string[] }[] = [];
    for (const profile of [...handPickedProfiles(), ...randomProfiles(150, 777)]) {
      const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
      const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
      if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) {
        mismatches.push({ profile, indexed, fullScan });
      }
    }
    expect(mismatches.length, `expected ZERO mismatches, found ${mismatches.length}: ${JSON.stringify(mismatches.slice(0, 3))}`).toBe(0);
  });
});

describe("candidate retrieval diagnostics — profile richness reduces touched work (section 7 / section 10)", () => {
  it("never performs a full linear scan of the whole constrained set: touched-entry count stays small for a sparse profile against a large catalog", () => {
    // A large catalog dominated by entries irrelevant to a sparse "age only" profile.
    const catalog: Benefit[] = [];
    for (let i = 0; i < 400; i++) {
      catalog.push(
        benefit(`region-${i}`, {
          eligibility: {
            type: "all",
            rules: [
              {
                id: "region",
                field: "residence",
                operator: "region_in",
                value: [{ province: PROVINCES[i % PROVINCES.length] }],
                required: true,
              },
            ],
          },
        })
      );
    }
    catalog.push(
      benefit("age-only", { eligibility: { type: "all", rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }] } })
    );
    const index = buildCandidateIndex(catalog);

    const { diagnostics } = getCandidateBenefitsWithDiagnostics(index, profileWithAge(25));
    // The profile has zero region data, so the 400 region-only entries must never be
    // touched by an index lookup or a fallback scan — only the "other"/fallback buckets
    // relevant to what's actually known should be examined, which here is ~0.
    expect(diagnostics.indexedLookupCount + diagnostics.fallbackScanCount).toBeLessThan(20);
    expect(diagnostics.indexedLookupCount + diagnostics.fallbackScanCount).toBeLessThan(catalog.length);
  });

  it("a richer (superset) profile never yields MORE final candidates than a sparser prefix of the same profile", () => {
    const catalog = buildSyntheticCatalog();
    const index = buildCandidateIndex(catalog);

    // Profiles A -> B -> C -> D are strict supersets of each other (same values, more
    // fields added each step), so richer input can only narrow the candidate set further
    // (or leave it unchanged) — it must never let something back in.
    const profileA: UserProfile = profileWithAge(29);
    const profileB: UserProfile = { ...profileA, residence: { province: "경기도" } };
    const profileC: UserProfile = { ...profileB, individualIncomeBand: "2000_3000" };
    const profileD: UserProfile = { ...profileC, educationStatus: "university", housingType: "jeonse", homeowner: false };

    const countA = getCandidateBenefits(index, profileA).length;
    const countB = getCandidateBenefits(index, profileB).length;
    const countC = getCandidateBenefits(index, profileC).length;
    const countD = getCandidateBenefits(index, profileD).length;

    expect(countB).toBeLessThanOrEqual(countA);
    expect(countC).toBeLessThanOrEqual(countB);
    expect(countD).toBeLessThanOrEqual(countC);
  });

  it("exposes indexedLookupCount/fallbackScanCount/finalCandidateCount without requiring profile values to be logged", () => {
    const catalog = buildSyntheticCatalog();
    const index = buildCandidateIndex(catalog);
    const { diagnostics } = getCandidateBenefitsWithDiagnostics(index, profileWithAge(25));
    expect(diagnostics).toEqual({
      indexedLookupCount: expect.any(Number),
      fallbackScanCount: expect.any(Number),
      finalCandidateCount: expect.any(Number),
    });
    expect(diagnostics.finalCandidateCount).toBe(getCandidateBenefits(index, profileWithAge(25)).length);
  });
});
