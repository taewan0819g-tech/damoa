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
import { getCurrentResidenceGazetteer } from "@/lib/eligibility/regionGazetteer";
import { PARENT_CITY_SUBDIVISIONS } from "@/domain/region/subdivisionPartition";
import type { RegionSpec } from "@/lib/eligibility/region";
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
 * Checkpoint: Youth zipCd nationwide-personalization correction. A
 * structured `region_in` OR-list can legitimately enumerate every current
 * city in the country (a nationwide program expressed as an explicit list)
 * or every city of a single province, not just a narrow local subset.
 * `regionSpecificityForLeaf`/`derivePersonalizationEvidence` must classify
 * these SEMANTICALLY (via `domain/region/regionScope.ts`, gazetteer-driven)
 * rather than merely checking "does any entry name the user's city" —
 * scenarios A-J below are the exact regression matrix from that checkpoint.
 * Eligibility (`matchRegion`/`evaluateEligibilityDetailed`) is completely
 * untouched — every scenario that PASSES here also still PASSES eligibility.
 */
describe("region breadth classification — nationwide/province OR-lists must not be misread as exact-city evidence", () => {
  const icheonProfile: UserProfile = {
    residence: { province: "경기도", city: "이천시" },
    interests: ["employment"],
  };

  function nationwideSpecs(): RegionSpec[] {
    const gaz = getCurrentResidenceGazetteer();
    const specs: RegionSpec[] = [];
    for (const [province, cities] of Object.entries(gaz)) {
      if (cities.length === 0) {
        specs.push({ province });
      } else {
        for (const city of cities) specs.push({ province, city });
      }
    }
    return specs;
  }

  function gyeonggiFullRosterSpecs(): RegionSpec[] {
    const gaz = getCurrentResidenceGazetteer();
    return gaz["경기도"].map((city) => ({ province: "경기도", city }));
  }

  function regionBenefit(id: string, value: RegionSpec[]): Benefit {
    return {
      id,
      title: "t",
      shortDescription: "d",
      category: "welfare",
      source: { type: "youth_policy", organization: "o" },
      benefitType: "cash",
      eligibility: {
        type: "all",
        rules: [{ id: "region", field: "residence", operator: "region_in", value, required: true }],
      },
    };
  }

  it("A) exact Icheon-only region -- region dimension counted, regionSpecificity exact_city", () => {
    const benefit = regionBenefit("a", [{ province: "경기도", city: "이천시" }]);
    const diag = evaluateEligibilityDetailed(benefit, icheonProfile);
    expect(diag.status).toBe("likely_eligible");
    const evidence = resolvePersonalizationEvidence(benefit, icheonProfile);
    expect(evidence.regionSpecificity).toBe("exact_city");
    expect(evidence.dimensions).toContain("region");
    expect(evidence.specificDimensionCount).toBe(1);
  });

  it("B) full explicit enumeration of every 경기도 city (province-wide, no single province-only spec) -- region counted, regionSpecificity province", () => {
    const benefit = regionBenefit("b", gyeonggiFullRosterSpecs());
    const diag = evaluateEligibilityDetailed(benefit, icheonProfile);
    expect(diag.status).toBe("likely_eligible");
    const evidence = resolvePersonalizationEvidence(benefit, icheonProfile);
    expect(evidence.regionSpecificity).toBe("province");
    expect(evidence.dimensions).toContain("region");
    expect(evidence.specificDimensionCount).toBe(1);
  });

  it("C) nationwide full current roster -- eligibility PASS, region dimension NOT counted, regionSpecificity none", () => {
    const benefit = regionBenefit("c", nationwideSpecs());
    const diag = evaluateEligibilityDetailed(benefit, icheonProfile);
    expect(diag.status).toBe("likely_eligible");
    const evidence = resolvePersonalizationEvidence(benefit, icheonProfile);
    expect(evidence.regionSpecificity).toBe("none");
    expect(evidence.dimensions).not.toContain("region");
    expect(evidence.specificDimensionCount).toBe(0);
  });

  it("D) nationwide region + employment -- specificDimensionCount counts employment only, not region", () => {
    const benefit: Benefit = {
      id: "d",
      title: "t",
      shortDescription: "d",
      category: "welfare",
      source: { type: "youth_policy", organization: "o" },
      benefitType: "cash",
      eligibility: {
        type: "all",
        rules: [
          { id: "region", field: "residence", operator: "region_in", value: nationwideSpecs(), required: true },
          {
            id: "employment",
            field: "employmentStatus",
            operator: "status_compat",
            value: { passValues: ["unemployed"], failValues: [] },
            required: true,
          },
        ],
      },
    };
    const employedProfile: UserProfile = { ...icheonProfile, employmentStatus: "unemployed" };
    const diag = evaluateEligibilityDetailed(benefit, employedProfile);
    expect(diag.status).toBe("likely_eligible");
    const evidence = resolvePersonalizationEvidence(benefit, employedProfile);
    expect(evidence.dimensions).toEqual(["employment"]);
    expect(evidence.specificDimensionCount).toBe(1);
    expect(evidence.strength).toBe("moderate");
  });

  it("E) nationwide + employment + matching employment interest -- totalIntersectionCount reflects 1 profile dimension + 1 interest, not 2 + 1", () => {
    const nationwideEmploymentBenefit: Benefit = {
      id: "e-nationwide",
      title: "t",
      shortDescription: "d",
      category: "employment", // matches profile.interests
      source: { type: "youth_policy", organization: "o" },
      benefitType: "cash",
      eligibility: {
        type: "all",
        rules: [
          { id: "region", field: "residence", operator: "region_in", value: nationwideSpecs(), required: true },
          {
            id: "employment",
            field: "employmentStatus",
            operator: "status_compat",
            value: { passValues: ["unemployed"], failValues: [] },
            required: true,
          },
        ],
      },
    };
    // A single-dimension local competitor with the SAME interest overlap, so
    // ranking is decided purely by totalIntersectionCount: if the nationwide
    // region leaf were (incorrectly) also counted as a specific dimension,
    // this benefit would score 2 (region+employment) + 1 (interest) = 3 and
    // wrongly outrank the exact-city competitor below, which correctly
    // scores 2 (region+employment) + 1 = 3 for a GENUINELY local match.
    const exactCityCompetitor: Benefit = {
      id: "e-local",
      title: "t",
      shortDescription: "d",
      category: "employment",
      source: { type: "youth_policy", organization: "o" },
      benefitType: "cash",
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
          {
            id: "employment",
            field: "employmentStatus",
            operator: "status_compat",
            value: { passValues: ["unemployed"], failValues: [] },
            required: true,
          },
        ],
      },
    };
    const employedIcheonProfile: UserProfile = { ...icheonProfile, employmentStatus: "unemployed" };
    const nationwideEvidence = resolvePersonalizationEvidence(nationwideEmploymentBenefit, employedIcheonProfile);
    expect(nationwideEvidence.specificDimensionCount).toBe(1); // employment only
    const localEvidence = resolvePersonalizationEvidence(exactCityCompetitor, employedIcheonProfile);
    expect(localEvidence.specificDimensionCount).toBe(2); // region + employment

    const statusById = new Map<string, EligibilityStatus>([
      ["e-nationwide", "likely_eligible"],
      ["e-local", "likely_eligible"],
    ]);
    const result = getRecommendedBenefits(
      [nationwideEmploymentBenefit, exactCityCompetitor],
      statusById,
      employedIcheonProfile,
      2
    );
    // Genuinely local (region+employment+interest) outranks nationwide
    // (employment+interest only) once the nationwide region leaf is
    // correctly excluded from specificDimensionCount.
    expect(result.map((b) => b.id)).toEqual(["e-local", "e-nationwide"]);
  });

  it("F) multi-city proper subset containing Icheon -- remains region-specific (exact_city-tier), never mistaken for nationwide", () => {
    const benefit = regionBenefit("f", [
      { province: "경기도", city: "이천시" },
      { province: "경기도", city: "수원시" },
      { province: "충청남도", city: "아산시" },
    ]);
    const evidence = resolvePersonalizationEvidence(benefit, icheonProfile);
    expect(evidence.regionSpecificity).toBe("exact_city");
    expect(evidence.dimensions).toContain("region");
  });

  it("G) full subdivision coverage of one parent city (수원시) -- remains local region-specific, not province/nationwide", () => {
    const suwonGu = PARENT_CITY_SUBDIVISIONS["경기도"]["수원시"];
    const specs: RegionSpec[] = suwonGu.map((subdivision) => ({ province: "경기도", city: "수원시", subdivision }));
    const benefit = regionBenefit("g", specs);
    const suwonProfile: UserProfile = { residence: { province: "경기도", city: "수원시" } };
    const diag = evaluateEligibilityDetailed(benefit, suwonProfile);
    expect(diag.status).toBe("likely_eligible"); // full gu-union completion -> PASS
    const evidence = resolvePersonalizationEvidence(benefit, suwonProfile);
    expect(evidence.regionSpecificity).toBe("exact_city");
    expect(evidence.dimensions).toContain("region");
  });

  it("H) partial subdivision coverage -- eligibility stays UNKNOWN, unaffected by this checkpoint", () => {
    const suwonGu = PARENT_CITY_SUBDIVISIONS["경기도"]["수원시"];
    const specs: RegionSpec[] = [{ province: "경기도", city: "수원시", subdivision: suwonGu[0] }];
    const benefit = regionBenefit("h", specs);
    const suwonProfile: UserProfile = { residence: { province: "경기도", city: "수원시" } };
    const diag = evaluateEligibilityDetailed(benefit, suwonProfile);
    expect(diag.status).toBe("unknown");
    expect(diag.failedRules).toBe(0);
  });

  it("I) historical-transition-completed PASS (old 인천 중구 spec + current 영종구 resident) keeps its pre-checkpoint 'province' ranking, unaffected", () => {
    const benefit = regionBenefit("i", [{ province: "인천광역시", city: "중구" }]);
    const yeongjongguProfile: UserProfile = { residence: { province: "인천광역시", city: "영종구" } };
    const diag = evaluateEligibilityDetailed(benefit, yeongjongguProfile);
    expect(diag.status).toBe("likely_eligible");
    const evidence = resolvePersonalizationEvidence(benefit, yeongjongguProfile);
    expect(evidence.regionSpecificity).toBe("province");
    expect(evidence.dimensions).toContain("region");
  });

  it("J) empty interests -- nationwide-region benefit still ranks sanely against a stronger local match (no interest signal to muddy the comparison)", () => {
    const nationwideOnly: Benefit = regionBenefit("j-nationwide", nationwideSpecs());
    const localOnly: Benefit = regionBenefit("j-local", [{ province: "경기도", city: "이천시" }]);
    const noInterestProfile: UserProfile = { residence: { province: "경기도", city: "이천시" } };
    const statusById = new Map<string, EligibilityStatus>([
      ["j-nationwide", "likely_eligible"],
      ["j-local", "likely_eligible"],
    ]);
    const result = getRecommendedBenefits([nationwideOnly, localOnly], statusById, noInterestProfile, 2);
    // local (specificDimensionCount=1, region) outranks nationwide
    // (specificDimensionCount=0) on totalIntersectionCount alone.
    expect(result.map((b) => b.id)).toEqual(["j-local", "j-nationwide"]);
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
 * §7 (interest-intersection ranking), corrected per the checkpoint that
 * introduced `totalIntersectionCount`: selected-interest overlap count is
 * combined with `specificDimensionCount` into a single
 * `totalIntersectionCount = specificDimensionCount + interestOverlapCount`
 * measure, which ranks immediately after EligibilityStatus — ahead of
 * personalization strength/region specificity. This means interest overlap
 * and matched-dimension count are weighted EQUALLY (neither strictly
 * dominates the other) rather than interest overlap unconditionally
 * outranking dimension-derived strength as an earlier iteration of this
 * comparator did. Only once the COMBINED total ties do personalization
 * strength, then region specificity, then interest overlap again (as a
 * secondary tie-break), then decide. See domain/benefit/recommend.ts's
 * comparator docs.
 */
describe("interest overlap combines with dimension count via totalIntersectionCount", () => {
  it("a stronger multi-dimension match with equal totalIntersectionCount outranks a single-dimension interest-only match", () => {
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
    // strong-no-interest-match: specificDimensionCount=2 (age+income),
    // interestOverlapCount=0 -> totalIntersectionCount=2.
    // weak-interest-match: specificDimensionCount=1 (age only),
    // interestOverlapCount=1 (employment) -> totalIntersectionCount=2.
    // The combined totals TIE, so the next tie-break (personalization
    // strength) decides -- strong-no-interest-match's richer structured
    // evidence (age+income both PASS) wins over weak-interest-match's
    // single age-only rule.
    expect(result.map((b) => b.id)).toEqual(["strong-no-interest", "weak-interest-match"]);
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
