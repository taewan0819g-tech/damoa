import { describe, expect, it } from "vitest";
import {
  derivePersonalizationEvidence,
  resolvePersonalizationEvidence,
  STRENGTH_RANK,
} from "@/domain/benefit/personalization";
import { getRecommendedBenefits } from "@/domain/benefit/recommend";
import { getUnknownBenefits } from "@/domain/benefit/unknownBenefits";
import { sortBenefits } from "@/domain/benefit/sort";
import { evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
import type { Benefit, EligibilityStatus, RuleOperator } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

function leaf(field: string, operator: RuleOperator, value?: unknown) {
  return { field, operator, value };
}

const profile: UserProfile = {
  birthDate: "2000-01-01",
  residence: { province: "경기도", city: "이천시" },
  interests: ["employment"],
};

/**
 * §6 strength classification: age-only/targetScope-only stay WEAK, exactly
 * one non-age specific dimension is MODERATE, 2+ distinct specific
 * dimensions is STRONG.
 */
describe("derivePersonalizationEvidence — strength rules", () => {
  it("classifies age-only evidence as WEAK", () => {
    const evidence = derivePersonalizationEvidence([leaf("age", "between", [19, 34])], profile);
    expect(evidence.strength).toBe("weak");
    // "age" IS a specific (non-targetScope) dimension, but being the ONLY
    // one keeps strength WEAK rather than MODERATE — see the strength rule.
    expect(evidence.specificDimensionCount).toBe(1);
  });

  it("classifies targetScope-only evidence as WEAK", () => {
    const evidence = derivePersonalizationEvidence([leaf("ignored", "target_scope_in", ["individual"])], profile);
    expect(evidence.strength).toBe("weak");
    expect(evidence.dimensions).toEqual(["targetScope"]);
    expect(evidence.specificDimensionCount).toBe(0);
  });

  it("classifies exactly one non-age specific dimension as MODERATE", () => {
    const evidence = derivePersonalizationEvidence([leaf("individualIncomeRange", "range_within", [0, 1000])], profile);
    expect(evidence.strength).toBe("moderate");
    expect(evidence.specificDimensionCount).toBe(1);
  });

  it("classifies age + one specific dimension as STRONG (2+ distinct specific dimensions)", () => {
    const evidence = derivePersonalizationEvidence(
      [leaf("age", "between", [19, 34]), leaf("individualIncomeRange", "range_within", [0, 1000])],
      profile
    );
    expect(evidence.strength).toBe("strong");
    expect(evidence.specificDimensionCount).toBe(2);
  });

  it("keeps age-only weaker than moderate/strong via STRENGTH_RANK", () => {
    expect(STRENGTH_RANK.strong).toBeLessThan(STRENGTH_RANK.moderate);
    expect(STRENGTH_RANK.moderate).toBeLessThan(STRENGTH_RANK.weak);
  });
});

/** §5 distinct dimensions must be deduplicated — multiple fields collapsing to one real-world dimension. */
describe("derivePersonalizationEvidence — dimension dedup", () => {
  it("collapses maritalStatus + marriageDate + childrenCount into a single 'family' dimension", () => {
    const evidence = derivePersonalizationEvidence(
      [
        leaf("maritalStatus", "eq", "married"),
        leaf("marriageDate", "marriage_duration_within", { years: 1, boundary: "이내" }),
        leaf("childrenCount", "gte", 1),
      ],
      profile
    );
    expect(evidence.dimensions).toEqual(["family"]);
    expect(evidence.specificDimensionCount).toBe(1);
    expect(evidence.strength).toBe("moderate"); // one non-age specific dimension
  });

  it("collapses multiple income rules into a single 'income' dimension", () => {
    const evidence = derivePersonalizationEvidence(
      [
        leaf("individualIncomeRange", "range_within", [0, 1000]),
        leaf("householdIncomeRange", "range_within", [0, 2000]),
        leaf("ignored", "median_income_threshold", { percent: 50 }),
      ],
      profile
    );
    expect(evidence.dimensions).toEqual(["income"]);
    expect(evidence.specificDimensionCount).toBe(1);
  });

  it("family + income together count as 2 distinct dimensions -> STRONG", () => {
    const evidence = derivePersonalizationEvidence(
      [leaf("maritalStatus", "eq", "married"), leaf("individualIncomeRange", "range_within", [0, 1000])],
      profile
    );
    expect(evidence.specificDimensionCount).toBe(2);
    expect(evidence.strength).toBe("strong");
  });
});

/**
 * §4 Youth region specificity must remain "none" unless a real, verified
 * `region_in` leaf actually passed — never inferred from title/institution/
 * provider/source name or zipCd.
 */
describe("resolvePersonalizationEvidence — region specificity never inferred from metadata", () => {
  const baseBenefit: Benefit = {
    id: "youth-1",
    title: "경기도 이천시 청년 지원금", // region keyword in the TITLE only
    shortDescription: "desc",
    category: "welfare",
    source: { type: "youth_policy", organization: "경기도 이천시청" }, // and in institution/provider name
    benefitType: "cash",
    eligibility: {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    },
  };

  it("stays 'none' when only title/institution mention a region, with no region_in rule at all", () => {
    const evidence = resolvePersonalizationEvidence(baseBenefit, profile);
    expect(evidence.regionSpecificity).toBe("none");
    expect(evidence.dimensions).not.toContain("region");
  });

  it("becomes 'province' only from a real verified region_in PASS naming the province without a city", () => {
    const benefit: Benefit = {
      ...baseBenefit,
      eligibility: {
        type: "all",
        rules: [{ id: "region", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true }],
      },
    };
    const evidence = resolvePersonalizationEvidence(benefit, profile);
    expect(evidence.regionSpecificity).toBe("province");
  });

  it("becomes 'exact_city' only from a real verified region_in PASS naming the user's exact city", () => {
    const benefit: Benefit = {
      ...baseBenefit,
      eligibility: {
        type: "all",
        rules: [
          {
            id: "region",
            field: "residence",
            operator: "region_in",
            value: [{ province: "경기도", city: "이천시" }],
            required: true,
          },
        ],
      },
    };
    const evidence = resolvePersonalizationEvidence(benefit, profile);
    expect(evidence.regionSpecificity).toBe("exact_city");
  });
});

/**
 * §1 eligibility semantics must be untouched by any of the ranking-evidence
 * plumbing — status is computed purely by evaluateEligibilityDetailed,
 * independent of derivePersonalizationEvidence.
 */
describe("eligibility status is unaffected by personalization evidence", () => {
  it("status/hasPositiveEvidence come from the rule engine regardless of evidence strength", () => {
    const benefit: Benefit = {
      id: "b1",
      title: "t",
      shortDescription: "d",
      category: "welfare",
      source: { type: "government", organization: "o" },
      benefitType: "other",
      eligibility: {
        type: "all",
        rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
      },
    };
    const diag = evaluateEligibilityDetailed(benefit, profile);
    expect(diag.status).toBe("likely_eligible");
    expect(diag.hasPositiveEvidence).toBe(true);
    // Evidence strength (weak, age-only) never feeds back into status.
    const evidence = derivePersonalizationEvidence(diag.passedLeaves, profile);
    expect(evidence.strength).toBe("weak");
    expect(diag.status).toBe("likely_eligible");
  });
});

/**
 * §2/§3: shared comparator, but different admission filtering between full
 * discovery (`sortBenefits`/`getRecommendedBenefits` default) and the home
 * preview (`getRecommendedBenefits` with `excludeWeakUnknown: true`).
 */
describe("full discovery vs home-preview admission filtering", () => {
  const strongLikely: Benefit = {
    id: "strong-likely",
    title: "strong likely",
    shortDescription: "d",
    category: "welfare",
    source: { type: "government", organization: "o" },
    benefitType: "other",
    eligibility: {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    },
  };
  const weakUnknown: Benefit = {
    id: "weak-unknown",
    title: "weak unknown (age-only, unresolved)",
    shortDescription: "d",
    category: "welfare",
    source: { type: "government", organization: "o" },
    benefitType: "other",
    eligibility: {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "region", field: "residence", operator: "region_in", value: [{ province: "부산광역시" }], required: true },
      ],
    },
  };

  const benefits = [strongLikely, weakUnknown];
  const statusById = new Map<string, EligibilityStatus>([
    ["strong-likely", "likely_eligible"],
    ["weak-unknown", "unknown"],
  ]);

  it("full-catalog default (excludeWeakUnknown=false) KEEPS the weak-evidence unknown, just ranked last", () => {
    const result = getRecommendedBenefits(benefits, statusById, profile, benefits.length);
    expect(result.map((b) => b.id)).toContain("weak-unknown");
    expect(result.map((b) => b.id).indexOf("weak-unknown")).toBeGreaterThan(
      result.map((b) => b.id).indexOf("strong-likely")
    );
  });

  it("sortBenefits(sort='recommended') never drops weak-evidence unknowns from the full list", () => {
    const sorted = sortBenefits(benefits, statusById, profile, "recommended");
    expect(sorted.map((b) => b.id).sort()).toEqual(["strong-likely", "weak-unknown"]);
  });

  it("home preview (excludeWeakUnknown=true) DROPS the weak-evidence unknown but keeps likely_eligible", () => {
    const result = getRecommendedBenefits(benefits, statusById, profile, benefits.length, { excludeWeakUnknown: true });
    expect(result.map((b) => b.id)).toEqual(["strong-likely"]);
  });

  it("getUnknownBenefits always keeps weak-evidence unknowns (it exists precisely to surface them)", () => {
    const result = getUnknownBenefits(benefits, statusById, profile);
    expect(result.map((b) => b.id)).toEqual(["weak-unknown"]);
  });

  it("recommended (home, weak-excluded) and needsReview never overlap", () => {
    const recommended = getRecommendedBenefits(benefits, statusById, profile, benefits.length, {
      excludeWeakUnknown: true,
    });
    const excludeIds = new Set(recommended.map((b) => b.id));
    const needsReview = getUnknownBenefits(benefits, statusById, profile, benefits.length, { excludeIds });
    const overlap = recommended.filter((r) => needsReview.some((n) => n.id === r.id));
    expect(overlap).toEqual([]);
    // The weak-unknown must still surface SOMEWHERE (needsReview), never silently dropped entirely.
    expect(needsReview.map((b) => b.id)).toEqual(["weak-unknown"]);
  });
});

/**
 * §7 (interest-intersection ranking): selected-interest overlap count now
 * ranks immediately after EligibilityStatus — ahead of personalization
 * strength/dimension count/region specificity — so a benefit matching more
 * of the user's selected interests outranks a "stronger" evidence match with
 * no interest overlap. See domain/benefit/recommend.ts's comparator docs.
 */
describe("interest overlap now outranks personalization strength", () => {
  it("lets a higher interest-overlap match outrank a stronger no-interest-overlap match", () => {
    // Distinct from the shared module-level `profile`: needs a resolvable
    // individualIncomeBand so the income rule below actually PASSES (an
    // unresolvable field would leave it out of passedLeaves entirely,
    // silently downgrading "strong" back to "weak" and defeating the test).
    const incomeProfile: UserProfile = { ...profile, individualIncomeBand: "under_1000" };
    const strongNoInterestMatch: Benefit = {
      id: "strong-no-interest",
      title: "t",
      shortDescription: "d",
      category: "housing", // not in profile.interests
      source: { type: "government", organization: "o" },
      benefitType: "other",
      eligibility: {
        type: "all",
        rules: [
          { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
          {
            id: "income",
            field: "individualIncomeRange",
            operator: "range_within",
            // Raw KRW, not 만원 — must fully CONTAIN the resolved
            // under_1000 band's {min:0, max:10_000_000} range to PASS.
            value: [0, 20_000_000],
            required: true,
          },
        ],
      },
    };
    const weakInterestMatch: Benefit = {
      id: "weak-interest-match",
      title: "t",
      shortDescription: "d",
      category: "employment", // IS in profile.interests
      source: { type: "government", organization: "o" },
      benefitType: "other",
      eligibility: {
        type: "all",
        rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
      },
    };
    const statusById = new Map<string, EligibilityStatus>([
      ["strong-no-interest", "likely_eligible"],
      ["weak-interest-match", "likely_eligible"],
    ]);
    const result = getRecommendedBenefits(
      [weakInterestMatch, strongNoInterestMatch],
      statusById,
      incomeProfile,
      2
    );
    // weak-interest-match matches a selected interest (employment) while
    // strong-no-interest-match matches none — interest overlap now wins.
    expect(result.map((b) => b.id)).toEqual(["weak-interest-match", "strong-no-interest"]);
  });

  it("breaks a tie between otherwise-equal candidates using interest overlap", () => {
    const matchesInterest: Benefit = {
      id: "matches-interest",
      title: "t",
      shortDescription: "d",
      category: "employment", // in profile.interests
      source: { type: "government", organization: "o" },
      benefitType: "other",
      eligibility: {
        type: "all",
        rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
      },
    };
    const noInterestMatch: Benefit = {
      id: "no-interest-match",
      title: "t",
      shortDescription: "d",
      category: "housing", // not in profile.interests
      source: { type: "government", organization: "o" },
      benefitType: "other",
      eligibility: {
        type: "all",
        rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
      },
    };
    const statusById = new Map<string, EligibilityStatus>([
      ["matches-interest", "likely_eligible"],
      ["no-interest-match", "likely_eligible"],
    ]);
    const result = getRecommendedBenefits([noInterestMatch, matchesInterest], statusById, profile, 2);
    expect(result.map((b) => b.id)).toEqual(["matches-interest", "no-interest-match"]);
  });
});
