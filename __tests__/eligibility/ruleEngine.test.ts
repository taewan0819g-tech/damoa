import { describe, expect, it } from "vitest";
import { evaluateEligibility, evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
import { derivePersonalizationEvidence } from "@/domain/benefit/personalization";
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

/** ISO date string `monthsAgo` months before the current wall-clock date. */
function recentIsoDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
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

  describe("range_within_interval (end-to-end through the rule engine, section 6/25)", () => {
    function incomeGroup(interval: { min?: number; max?: number; minInclusive: boolean; maxInclusive: boolean }): EligibilityRuleGroup {
      return {
        type: "all",
        rules: [{ id: "income", field: "individualIncomeRange", operator: "range_within_interval", value: interval, required: true }],
      };
    }

    it("an exact 35,000,000원 income FAILS a strict 미만 (< 35,000,000) policy", () => {
      const status = evaluateEligibility(
        makeBenefit({ eligibility: incomeGroup({ max: 35_000_000, minInclusive: true, maxInclusive: false }) }),
        { annualIndividualIncome: 35_000_000 }
      );
      expect(status).toBe("not_eligible");
    });

    it("the SAME exact 35,000,000원 income PASSES an inclusive 이하 (<= 35,000,000) policy", () => {
      const status = evaluateEligibility(
        makeBenefit({ eligibility: incomeGroup({ max: 35_000_000, minInclusive: true, maxInclusive: true }) }),
        { annualIndividualIncome: 35_000_000 }
      );
      expect(status).toBe("likely_eligible");
    });

    it("resolves to unknown (not a guess) when the user's income band straddles a strict boundary", () => {
      const status = evaluateEligibility(
        makeBenefit({ eligibility: incomeGroup({ max: 35_000_000, minInclusive: true, maxInclusive: false }) }),
        { individualIncomeBand: "3000_4000" } // {min:30M, max:40M} straddles 35M
      );
      expect(status).toBe("unknown");
    });
  });

  describe("status_compat (employment, end-to-end through the rule engine, section 11/25)", () => {
    function employmentGroup(target: "unemployed" | "employed"): EligibilityRuleGroup {
      return {
        type: "all",
        rules: [
          {
            id: "employment",
            field: "employmentStatus",
            operator: "status_compat",
            value:
              target === "unemployed"
                ? { passValues: ["unemployed"], failValues: ["employed"] }
                : { passValues: ["employed"], failValues: ["unemployed"] },
            required: true,
          },
        ],
      };
    }

    it("passes an unemployed applicant against a 미취업자 requirement", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: employmentGroup("unemployed") }), {
        employmentStatus: "unemployed",
      });
      expect(status).toBe("likely_eligible");
    });

    it("fails an employed applicant against a 미취업자 requirement", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: employmentGroup("unemployed") }), {
        employmentStatus: "employed",
      });
      expect(status).toBe("not_eligible");
    });

    it("never guesses for a freelancer — resolves to unknown rather than pass or fail", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: employmentGroup("unemployed") }), {
        employmentStatus: "freelancer",
      });
      expect(status).toBe("unknown");
    });
  });

  describe("newlywed compound rule (maritalStatus==married AND marriage_duration_within, end-to-end)", () => {
    // Mirrors exactly what the parser emits for a clearly-CURRENT "신혼부부
    // ... 혼인신고일이 1년 이내" clause (see koreanEligibilityParser.ts's
    // parseMarriageDurationClause / NEWLYWED_CURRENT_RE): a divorced/widowed
    // applicant with a recent historical marriage date must NOT pass on the
    // marriageDate condition alone — maritalStatus must also currently be
    // "married".
    const newlywedGroup: EligibilityRuleGroup = {
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
    };

    it("married + recent marriageDate -> likely_eligible (PASS)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: newlywedGroup }), {
        maritalStatus: "married",
        marriageDate: recentIsoDate(6), // 6 months ago, within a 1-year window
      });
      expect(status).toBe("likely_eligible");
    });

    it("married + old marriageDate -> not_eligible (FAIL, duration condition fails)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: newlywedGroup }), {
        maritalStatus: "married",
        marriageDate: recentIsoDate(36), // 3 years ago, outside a 1-year window
      });
      expect(status).toBe("not_eligible");
    });

    it("divorced + recent historical marriageDate -> not_eligible (FAIL, maritalStatus condition fails — the core bug this compound rule fixes)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: newlywedGroup }), {
        maritalStatus: "divorced",
        marriageDate: recentIsoDate(6),
      });
      expect(status).toBe("not_eligible");
    });

    it("widowed + recent historical marriageDate -> not_eligible (FAIL, maritalStatus condition fails)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: newlywedGroup }), {
        maritalStatus: "widowed",
        marriageDate: recentIsoDate(6),
      });
      expect(status).toBe("not_eligible");
    });

    it("missing maritalStatus -> unknown (never guessed as pass or fail)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: newlywedGroup }), {
        marriageDate: recentIsoDate(6),
      });
      expect(status).toBe("unknown");
    });

    it("missing marriageDate -> unknown (never guessed as pass or fail)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: newlywedGroup }), {
        maritalStatus: "married",
      });
      expect(status).toBe("unknown");
    });
  });

  describe("median_income_threshold (checkpoint-3, end-to-end through the rule engine)", () => {
    // Current wall-clock date resolves to policy year 2026 (see
    // domain/medianIncome/table.ts). 2026 4-person monthly = 6,494,738 KRW ->
    // 50% annual threshold = 6,494,738 * 0.5 * 12 = 38,968,428.
    const THRESHOLD_50PCT_4PERSON_2026 = 38968428;

    function medianIncomeGroup(overrides: Partial<Record<string, unknown>> = {}): EligibilityRuleGroup {
      return {
        type: "all",
        rules: [
          {
            id: "median-income",
            field: "householdIncomeRange",
            operator: "median_income_threshold",
            required: true,
            value: {
              percent: 50,
              boundary: "lte",
              incomeMetric: "household_income",
              householdSizeMode: "scales_with_profile_household",
              ...overrides,
            },
          },
        ],
      };
    }

    it("evaluates against the whole profile (householdIncomeRange AND householdSize), ignoring rule.field's literal value", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: medianIncomeGroup() }), {
        householdSize: 4,
        annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026,
      });
      expect(status).toBe("likely_eligible");
    });

    it("fails when household income exceeds the threshold", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: medianIncomeGroup() }), {
        householdSize: 4,
        annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 + 1,
      });
      expect(status).toBe("not_eligible");
    });

    it("resolves to unknown when householdSize is missing (can't pick a table row)", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: medianIncomeGroup() }), {
        annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026,
      });
      expect(status).toBe("unknown");
    });

    it("resolves to unknown when household income is missing", () => {
      const status = evaluateEligibility(makeBenefit({ eligibility: medianIncomeGroup() }), {
        householdSize: 4,
      });
      expect(status).toBe("unknown");
    });

    it("fixed_reference_household uses the spec's fixedHouseholdSize, not the applicant's own household size", () => {
      const group = medianIncomeGroup({ householdSizeMode: "fixed_reference_household", fixedHouseholdSize: 4 });
      const status = evaluateEligibility(makeBenefit({ eligibility: group }), {
        householdSize: 1, // would resolve to a much lower threshold if used
        annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026,
      });
      expect(status).toBe("likely_eligible");
    });

    it("Section M regression: a single successful median_income_threshold parse must NOT promote an otherwise-incomplete benefit to likely_eligible", () => {
      const benefit = {
        eligibility: medianIncomeGroup(),
        hasUnresolvedEligibility: true, // e.g. an unparsed 소득인정액 clause elsewhere in the source
      };
      const status = evaluateEligibility(makeBenefit(benefit), {
        householdSize: 4,
        annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026,
      });
      // All parsed rules pass, but the benefit is known-incomplete, so the
      // generic downgrade logic in evaluateEligibilityDetailed must hold this
      // at "unknown" rather than over-claiming likely_eligible.
      expect(status).toBe("unknown");
    });

    it("Section M regression: a definite FAIL still resolves to not_eligible even when the benefit is incomplete", () => {
      const benefit = {
        eligibility: medianIncomeGroup(),
        hasUnresolvedEligibility: true,
      };
      const status = evaluateEligibility(makeBenefit(benefit), {
        householdSize: 4,
        annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 + 1,
      });
      expect(status).toBe("not_eligible");
    });
  });

  describe("OR-branch personalization evidence isolation (ranker-hardening checkpoint, issue #2)", () => {
    // Regression for "OR-branch personalization inflation": `passedLeaves`
    // (the evidence `derivePersonalizationEvidence` uses for ranking
    // strength — see domain/benefit/personalization.ts) must never union PASS
    // leaves from mutually ALTERNATIVE branches of an `any` group. An audit
    // of the real, committed frozen MOIS + Youth Center catalog
    // (scripts/auditOrBranchInflation.ts, /tmp/or-branch-inflation-audit.json)
    // found ZERO benefits whose eligibility tree contains an `any` group at
    // all — every adapter (MOISAdapter, YouthAdapter) only ever constructs
    // `type: "all"` groups, and the Korean free-text parser's OR-detection
    // safety net (koreanEligibilityParser.ts's hasLocalCrossDimensionOr)
    // deliberately bails out to `unresolvedClauses` instead of building a
    // nested `any` group. So this scenario is not reachable today. This test
    // documents the invariant directly against a synthetic `any` group so it
    // stays enforced if a future adapter/parser ever starts emitting one.
    it("does not union PASS evidence across mutually alternative `any`-group branches", () => {
      // (age PASS + income UNKNOWN) OR (region PASS + employment UNKNOWN) —
      // neither branch fully resolves to "pass" on its own (each has an
      // unresolved sibling condition), so the group's overall result is
      // "unknown". The OLD flat-leaf-union strategy would still have
      // collected BOTH the age leaf and the region leaf into `passedLeaves`
      // (since evaluateNode pushes every visited leaf's result into the flat
      // `leaves` array regardless of which branch "wins"), inflating
      // specificDimensionCount to 2 and wrongly reporting STRONG evidence for
      // a benefit whose eligibility is actually still fully unresolved.
      const anyGroup: EligibilityRuleGroup = {
        type: "any",
        rules: [
          {
            type: "all",
            rules: [
              { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
              { id: "income", field: "individualIncomeRange", operator: "lte", value: 30_000_000, required: true },
            ],
          },
          {
            type: "all",
            rules: [
              { id: "region", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true },
              { id: "employment", field: "employmentStatus", operator: "eq", value: "unemployed", required: true },
            ],
          },
        ],
      };
      const profile: UserProfile = {
        birthDate: `${new Date().getFullYear() - 25}-01-01`, // age PASS
        // individualIncomeRange omitted -> income UNKNOWN (branch 1 unresolved)
        residence: { province: "경기도" }, // region PASS
        // employmentStatus omitted -> employment UNKNOWN (branch 2 unresolved)
      };

      const diag = evaluateEligibilityDetailed({ eligibility: anyGroup }, profile);

      // Neither alternative branch fully passed, so the group (and status)
      // must resolve to unknown — never a guessed pass.
      expect(diag.status).toBe("unknown");

      // The critical assertion: passedLeaves must be EMPTY. Both age and
      // region individually evaluated to "pass" as leaves, but neither of
      // their own branches (as a whole `all` group) resolved to "pass", so
      // branch-aware evidence collection must not surface either of them as
      // ranking evidence — union-ing them would let a fully-unresolved
      // benefit masquerade as a 2-dimension STRONG match.
      expect(diag.passedLeaves).toEqual([]);
    });

    it("DOES surface evidence from a branch that fully resolves to pass, even inside an `any` group", () => {
      const anyGroup: EligibilityRuleGroup = {
        type: "any",
        rules: [
          {
            type: "all",
            rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
          },
          {
            type: "all",
            rules: [{ id: "region", field: "residence", operator: "region_in", value: [{ province: "전라남도" }], required: true }],
          },
        ],
      };
      const profile: UserProfile = {
        birthDate: `${new Date().getFullYear() - 25}-01-01`, // age branch fully PASSes
        residence: { province: "경기도" }, // region branch FAILs outright (not unknown)
      };

      const diag = evaluateEligibilityDetailed({ eligibility: anyGroup }, profile);

      expect(diag.status).toBe("likely_eligible");
      // Only the age leaf (the branch that actually resolved to pass) is
      // surfaced — the failed region branch contributes nothing.
      expect(diag.passedLeaves).toEqual([{ field: "age", operator: "between", value: [19, 34] }]);
    });

    it("uses evidence from exactly ONE alternative branch when MULTIPLE branches all independently pass — never unions across them", () => {
      // (age PASS) OR (region PASS) — both alternatives happen to hold for
      // this user. The benefit only required ONE of the two paths, so only
      // ONE path's evidence is real; unioning "age" + "region" from two
      // independently-passing alternative branches would fabricate the same
      // 2-dimension STRONG evidence this whole guard exists to prevent, just
      // via multiple-pass instead of partial-pass branches.
      const anyGroup: EligibilityRuleGroup = {
        type: "any",
        rules: [
          {
            type: "all",
            rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
          },
          {
            type: "all",
            rules: [{ id: "region", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true }],
          },
        ],
      };
      const profile: UserProfile = {
        birthDate: `${new Date().getFullYear() - 25}-01-01`, // age branch PASSes
        residence: { province: "경기도" }, // region branch ALSO PASSes
      };

      const diag = evaluateEligibilityDetailed({ eligibility: anyGroup }, profile);

      expect(diag.status).toBe("likely_eligible");
      // Evidence must come from exactly ONE branch (deterministically the
      // first passing branch in rule-declaration order — age here), never
      // both. Must NOT equal the 2-leaf union [age, region].
      expect(diag.passedLeaves).toEqual([{ field: "age", operator: "between", value: [19, 34] }]);
      expect(diag.passedLeaves.length).toBe(1);

      // The resulting personalization strength must not be artificially
      // inflated to STRONG by a fabricated age+region combination.
      const evidence = derivePersonalizationEvidence(diag.passedLeaves, profile);
      expect(evidence.dimensions).not.toContain("region");
      expect(evidence.specificDimensionCount).toBe(1);
    });
  });
});
