import { describe, expect, it } from "vitest";
import { countUserInterestOverlap } from "@/domain/benefit/topics";
import { getRecommendedBenefits } from "@/domain/benefit/recommend";
import { sortBenefits } from "@/domain/benefit/sort";
import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Interest-intersection ranking regression tests. Selected-interest overlap
 * count (`countUserInterestOverlap`) now ranks candidates immediately after
 * EligibilityStatus in `getRecommendedBenefits`' comparator — see
 * domain/benefit/recommend.ts's doc comment — but only ever REORDERS
 * candidates that already survived eligibility/safety admission. It must
 * never resurrect a not_eligible or (for the Home preview) locally-unresolved
 * candidate.
 */
const profile: UserProfile = {
  residence: { province: "경기도", city: "이천시" },
  individualIncomeBand: "under_1000",
};

const selectedInterests = ["housing", "loan", "employment"] as const;

function makeBenefit(overrides: Partial<Benefit> & Pick<Benefit, "id" | "source">): Benefit {
  return {
    title: "t",
    shortDescription: "d",
    category: "welfare",
    benefitType: "other",
    eligibility: { type: "all", rules: [] },
    ...overrides,
  };
}

describe("A/B. interest overlap count ranks candidates: 2 > 1 > 0 matches", () => {
  const housingLoan = makeBenefit({
    id: "housing-loan",
    source: { type: "government", organization: "o" },
    category: "housing",
    topics: ["housing"],
    financialFacets: ["loan"],
  });
  const employmentOnly = makeBenefit({
    id: "employment-only",
    source: { type: "government", organization: "o" },
    category: "employment",
    topics: ["employment"],
  });
  const noInterestMatch = makeBenefit({
    id: "no-interest",
    source: { type: "government", organization: "o" },
    category: "welfare",
    topics: ["welfare"],
  });

  const benefits = [noInterestMatch, employmentOnly, housingLoan];
  const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "likely_eligible"]));
  const interestProfile: UserProfile = { ...profile, interests: [...selectedInterests] };

  it("ranks housing+loan (2 matches) above employment-only (1 match) above no-interest (0 matches)", () => {
    const result = getRecommendedBenefits(benefits, statusById, interestProfile, benefits.length);
    expect(result.map((b) => b.id)).toEqual(["housing-loan", "employment-only", "no-interest"]);
  });

  it("B. strictly orders 3 > 2 > 1 > 0 matched interests", () => {
    const threeMatch = makeBenefit({
      id: "three-match",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing", "employment"],
      financialFacets: ["loan"],
    });
    const all = [noInterestMatch, employmentOnly, housingLoan, threeMatch];
    const statuses = new Map<string, EligibilityStatus>(all.map((b) => [b.id, "likely_eligible"]));
    const result = getRecommendedBenefits(all, statuses, interestProfile, all.length);
    expect(result.map((b) => b.id)).toEqual(["three-match", "housing-loan", "employment-only", "no-interest"]);
    expect(result.map((b) => countUserInterestOverlap(b, selectedInterests))).toEqual([3, 2, 1, 0]);
  });
});

describe("C. duplicate topic/facet/category representation of the same selected interest counts once", () => {
  it("a benefit whose category AND topics both say 'housing' still only outranks a true 0-match benefit by one interest, not two", () => {
    const redundantHousing = makeBenefit({
      id: "redundant-housing",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing"], // redundant with category — same selected interest, two channels
    });
    const genuineTwoMatch = makeBenefit({
      id: "genuine-two-match",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing"],
      financialFacets: ["loan"], // a REAL second distinct selected interest
    });
    const interestProfile: UserProfile = { ...profile, interests: [...selectedInterests] };
    const statusById = new Map<string, EligibilityStatus>([
      ["redundant-housing", "likely_eligible"],
      ["genuine-two-match", "likely_eligible"],
    ]);
    const result = getRecommendedBenefits(
      [redundantHousing, genuineTwoMatch],
      statusById,
      interestProfile,
      2
    );
    // genuine-two-match (2 distinct interests) outranks redundant-housing (1 distinct interest, doubly-represented).
    expect(result.map((b) => b.id)).toEqual(["genuine-two-match", "redundant-housing"]);
  });
});

describe("D. financial facets: a housing loan matches both 'housing' and 'loan' when both are selected", () => {
  it("counts 2 when the user selected both housing and loan", () => {
    const housingLoan = makeBenefit({
      id: "housing-loan-2",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing"],
      financialFacets: ["loan"],
    });
    expect(countUserInterestOverlap(housingLoan, ["housing", "loan"])).toBe(2);
  });
});

describe("E. multi-topic benefits correctly count multiple selected interests", () => {
  it("counts every distinct selected interest a multi-topic benefit carries", () => {
    const multiTopic = makeBenefit({
      id: "multi-topic",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing", "startup", "employment"],
    });
    expect(countUserInterestOverlap(multiTopic, ["housing", "startup", "employment", "childcare"])).toBe(3);
  });
});

describe("F. interest overlap can never resurrect a not_eligible benefit", () => {
  it("excludes a not_eligible benefit from recommended even with maximal interest overlap", () => {
    const maxInterestButIneligible = makeBenefit({
      id: "max-interest-ineligible",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing", "employment"],
      financialFacets: ["loan"],
    });
    const eligibleZeroInterest = makeBenefit({
      id: "eligible-zero-interest",
      source: { type: "government", organization: "o" },
      category: "welfare",
    });
    const statusById = new Map<string, EligibilityStatus>([
      ["max-interest-ineligible", "not_eligible"],
      ["eligible-zero-interest", "likely_eligible"],
    ]);
    const interestProfile: UserProfile = { ...profile, interests: [...selectedInterests] };
    const result = getRecommendedBenefits(
      [maxInterestButIneligible, eligibleZeroInterest],
      statusById,
      interestProfile,
      2
    );
    expect(result.map((b) => b.id)).toEqual(["eligible-zero-interest"]);
  });
});

describe("G. Home unresolved-local-scope precision gate still wins over interest overlap", () => {
  it("excludes an unresolved-other-region local policy from Home recommended even with full interest overlap", () => {
    const incomeRule = {
      id: "income",
      field: "individualIncomeRange" as const,
      operator: "range_within" as const,
      value: [0, 20_000_000],
      required: true,
    };
    const wrongRegionHighInterest = makeBenefit({
      id: "wrong-region-high-interest",
      source: { type: "government", organization: "경상남도" },
      institution: { name: "경상남도", type: "local_government" },
      category: "housing",
      topics: ["housing", "employment"],
      financialFacets: ["loan"],
      eligibility: { type: "all", rules: [incomeRule] },
    });
    const gyeonggiWideLowInterest = makeBenefit({
      id: "gyeonggi-wide-low-interest",
      source: { type: "government", organization: "경기도" },
      institution: { name: "경기도", type: "local_government" },
      category: "welfare",
      eligibility: {
        type: "all",
        rules: [
          incomeRule,
          { id: "region", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true },
        ],
      },
    });
    const benefits = [wrongRegionHighInterest, gyeonggiWideLowInterest];
    const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));
    const interestProfile: UserProfile = { ...profile, interests: [...selectedInterests] };

    const home = getRecommendedBenefits(benefits, statusById, interestProfile, benefits.length, {
      excludeWeakUnknown: true,
    });
    const homeIds = home.map((b) => b.id);
    expect(homeIds).not.toContain("wrong-region-high-interest");
    expect(homeIds).toContain("gyeonggi-wide-low-interest");
  });
});

describe("H. full /benefits recall membership is unchanged by interest ranking", () => {
  it("sortBenefits(sort='recommended') keeps the exact same membership set regardless of interest overlap, just reorders", () => {
    const highInterest = makeBenefit({
      id: "high-interest",
      source: { type: "government", organization: "o" },
      category: "housing",
      topics: ["housing"],
      financialFacets: ["loan"],
    });
    const zeroInterest = makeBenefit({
      id: "zero-interest",
      source: { type: "government", organization: "o" },
      category: "welfare",
    });
    const benefits = [zeroInterest, highInterest];
    const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "likely_eligible"]));

    const noInterestProfile: UserProfile = { ...profile, interests: [] };
    const withInterestProfile: UserProfile = { ...profile, interests: [...selectedInterests] };

    const withoutInterest = sortBenefits(benefits, statusById, noInterestProfile, "recommended");
    const withInterest = sortBenefits(benefits, statusById, withInterestProfile, "recommended");

    expect(new Set(withoutInterest.map((b) => b.id))).toEqual(new Set(withInterest.map((b) => b.id)));
    expect(withInterest.map((b) => b.id)).toEqual(["high-interest", "zero-interest"]);
  });
});

describe("I. empty selected interests preserve the pre-interest-ranking order", () => {
  it("falls through to strength/dimension/region ordering when profile.interests is empty (every candidate scores 0 overlap)", () => {
    const strongEvidence = makeBenefit({
      id: "strong-evidence",
      source: { type: "government", organization: "o" },
      category: "housing",
      eligibility: {
        type: "all",
        rules: [
          { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
          {
            id: "income",
            field: "individualIncomeRange",
            operator: "range_within",
            value: [0, 20_000_000],
            required: true,
          },
        ],
      },
    });
    const weakEvidence = makeBenefit({
      id: "weak-evidence",
      source: { type: "government", organization: "o" },
      category: "welfare",
      eligibility: {
        type: "all",
        rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
      },
    });
    const statusById = new Map<string, EligibilityStatus>([
      ["strong-evidence", "likely_eligible"],
      ["weak-evidence", "likely_eligible"],
    ]);
    const noInterestProfile: UserProfile = { ...profile, interests: [] };
    const result = getRecommendedBenefits([weakEvidence, strongEvidence], statusById, noInterestProfile, 2);
    // Both score 0 interest overlap (empty interests) — falls through to strength ranking.
    expect(result.map((b) => b.id)).toEqual(["strong-evidence", "weak-evidence"]);
  });
});
