import { describe, expect, it } from "vitest";
import {
  TOPIC_PRIORITY,
  STARTUP_WORDS,
  TRANSPORT_WORDS,
  deriveFinancialFacets,
  finalizeTopics,
  hasAssetBuildingSignal,
  hasChildcareSignal,
  hasHousingSignal,
  matchesBenefitFacet,
  matchesUserInterest,
  primaryCategory,
} from "@/domain/benefit/topics";
import { normalizeMOISServiceListItem, type MOISRawServiceListItem } from "@/adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";
import { INTEREST_CATEGORIES } from "@/lib/constants/interests";
import type { Benefit, BenefitCategory } from "@/types/benefit";

function moisRaw(overrides: Partial<MOISRawServiceListItem>): MOISRawServiceListItem {
  return { 서비스ID: "1", 서비스명: "Test Service", 소관기관명: "Test Org", ...overrides };
}

function youthRaw(overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return { plcyNo: "1", plcyNm: "Test Policy", ...overrides };
}

function minimalBenefit(overrides: Partial<Benefit>): Benefit {
  return {
    id: "b-1",
    title: "Test",
    shortDescription: "Test",
    category: "welfare",
    source: { type: "government", organization: "Org" },
    benefitType: "other",
    institution: { name: "Org", type: "government" },
    isDemo: true,
    ...overrides,
  };
}

// A. hasAssetBuildingSignal only fires on genuine finance words.
describe("hasAssetBuildingSignal", () => {
  it("matches 예금/적금/저축/자산형성", () => {
    expect(hasAssetBuildingSignal("청년 예금 상품")).toBe(true);
    expect(hasAssetBuildingSignal("청년 적금 상품")).toBe(true);
    expect(hasAssetBuildingSignal("저축 장려금")).toBe(true);
    expect(hasAssetBuildingSignal("자산형성 지원")).toBe(true);
  });

  it("does NOT match a bare 금융 with no specific instrument word", () => {
    expect(hasAssetBuildingSignal("금융·복지·문화")).toBe(false);
  });

  it("does NOT match loan words alone", () => {
    expect(hasAssetBuildingSignal("전세자금 대출이자 지원")).toBe(false);
    expect(hasAssetBuildingSignal("학자금대출 이자지원")).toBe(false);
  });
});

// B. deriveFinancialFacets keyword coverage, independent facets.
describe("deriveFinancialFacets", () => {
  it("derives deposit/savings/loan independently and can return multiple facets", () => {
    expect(deriveFinancialFacets("정기예금")).toEqual(["deposit"]);
    expect(deriveFinancialFacets("자유적금")).toEqual(["savings"]);
    expect(deriveFinancialFacets("전세자금대출")).toEqual(["loan"]);
    expect(deriveFinancialFacets("예금 적금 대출")).toEqual(["deposit", "savings", "loan"]);
  });

  it("returns an empty array when no instrument word is present", () => {
    expect(deriveFinancialFacets("청년 취업지원 프로그램")).toEqual([]);
  });
});

// C. finalizeTopics: empty-set fallback and deterministic TOPIC_PRIORITY ordering.
describe("finalizeTopics", () => {
  it("falls back to ['welfare'] for an empty set", () => {
    expect(finalizeTopics(new Set())).toEqual(["welfare"]);
  });

  it("orders a multi-topic set deterministically by TOPIC_PRIORITY, regardless of insertion order", () => {
    const topics = finalizeTopics(new Set(["asset_building", "housing", "startup"]));
    expect(topics).toEqual(["housing", "startup", "asset_building"]);
    // Sanity check against the shared priority list itself.
    const indices = topics.map((t) => TOPIC_PRIORITY.indexOf(t));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});

// D. primaryCategory collapses a topic set to the single highest-priority value.
describe("primaryCategory", () => {
  it("picks the highest-priority topic present", () => {
    expect(primaryCategory(["asset_building", "housing"])).toBe("housing");
    expect(primaryCategory(["welfare"])).toBe("welfare");
  });

  it("defaults to 'welfare' for an empty iterable", () => {
    expect(primaryCategory([])).toBe("welfare");
  });
});

// E. matchesBenefitFacet: direct category equality preserved for legacy/FSS/mock data.
describe("matchesBenefitFacet — direct category equality (backward compatibility)", () => {
  it("matches when category equals the checked value, even with no topics/financialFacets set", () => {
    const benefit = minimalBenefit({ category: "deposit" });
    expect(matchesBenefitFacet(benefit, "deposit")).toBe(true);
    expect(matchesBenefitFacet(benefit, "savings")).toBe(false);
  });
});

// F. matchesBenefitFacet: financial-instrument facet membership (§6 fix).
describe("matchesBenefitFacet — financialFacets membership", () => {
  it("matches a deposit/savings/loan interest via financialFacets even when category is a different topic", () => {
    const benefit = minimalBenefit({ category: "housing", financialFacets: ["loan"] });
    expect(matchesBenefitFacet(benefit, "loan")).toBe(true);
    expect(matchesBenefitFacet(benefit, "deposit")).toBe(false);
  });

  it("does not match a financial-facet interest when financialFacets is absent", () => {
    const benefit = minimalBenefit({ category: "housing" });
    expect(matchesBenefitFacet(benefit, "loan")).toBe(false);
  });
});

// G. matchesBenefitFacet: multi-topic membership (the "청년 창업 임대료 지원" case, §4/multi-topic fix).
describe("matchesBenefitFacet — topics membership", () => {
  it("matches a non-primary topic even though category only reflects the highest-priority one", () => {
    const benefit = minimalBenefit({ category: "housing", topics: ["housing", "startup"] });
    expect(matchesBenefitFacet(benefit, "startup")).toBe(true);
    expect(matchesBenefitFacet(benefit, "housing")).toBe(true);
    expect(matchesBenefitFacet(benefit, "employment")).toBe(false);
  });
});

// H. matchesUserInterest: OR across every selected interest.
describe("matchesUserInterest", () => {
  it("matches if ANY selected interest matches, via category, topics, or financialFacets", () => {
    const benefit = minimalBenefit({ category: "housing", topics: ["housing", "startup"], financialFacets: ["loan"] });
    expect(matchesUserInterest(benefit, ["employment", "loan"])).toBe(true);
    expect(matchesUserInterest(benefit, ["employment", "childcare"])).toBe(false);
    expect(matchesUserInterest(benefit, [])).toBe(false);
  });
});

// I. THE core §4 audit fix: Youth Center's combined lclsfNm umbrella label must
// never leak a bare "금융" match into asset_building.
describe("YouthAdapter — asset_building §4 fix", () => {
  it("does NOT tag asset_building for a record whose only 금융 signal is the combined lclsfNm umbrella label", () => {
    const benefit = normalizeYouthPolicy(
      youthRaw({ plcyNm: "청년 마음건강 상담 지원", lclsfNm: "금융·복지·문화", mclsfNm: "상담·심리" })
    );
    expect(benefit.topics).not.toContain("asset_building");
    expect(benefit.category).not.toBe("asset_building");
  });

  it("does NOT tag asset_building for the 취약계층 및 금융지원 mclsfNm bucket alone (rejected allowlist)", () => {
    const benefit = normalizeYouthPolicy(
      youthRaw({ plcyNm: "청년 상해보험 가입 지원", lclsfNm: "금융·복지·문화", mclsfNm: "취약계층 및 금융지원" })
    );
    expect(benefit.topics).not.toContain("asset_building");
  });

  it("DOES tag asset_building when a genuine instrument word appears in mclsfNm/plcyKywdNm/plcyNm", () => {
    const benefit = normalizeYouthPolicy(
      youthRaw({
        plcyNm: "청년내일저축계좌",
        lclsfNm: "금융·복지·문화",
        mclsfNm: "취약계층 및 금융지원",
        plcyKywdNm: "저축",
      })
    );
    expect(benefit.topics).toContain("asset_building");
    expect(benefit.financialFacets).toContain("savings");
  });
});

// J. Youth loan-purpose records: loan words route to financialFacets, not asset_building.
describe("YouthAdapter — loan facet vs. asset_building topic separation", () => {
  it("tags a jeonse-loan-interest-support record as topic housing + facet loan, not asset_building", () => {
    const benefit = normalizeYouthPolicy(
      youthRaw({ plcyNm: "청년 전세자금대출 이자지원", lclsfNm: "주거", mclsfNm: "주거지원" })
    );
    expect(benefit.topics).toContain("housing");
    expect(benefit.topics).not.toContain("asset_building");
    expect(benefit.financialFacets).toContain("loan");
  });
});

// K. MOISAdapter: 서비스분야 is a proper single-purpose field, safe to scan directly;
// loan words still stay out of asset_building.
describe("MOISAdapter — topic/facet derivation", () => {
  it("tags asset_building + savings facet for a genuine savings program", () => {
    const benefit = normalizeMOISServiceListItem(
      moisRaw({ 서비스명: "청년내일저축계좌 지원", 서비스분야: "금융" })
    );
    expect(benefit.topics).toContain("asset_building");
    expect(benefit.financialFacets).toContain("savings");
  });

  it("routes a housing loan to topic housing + facet loan, never asset_building", () => {
    const benefit = normalizeMOISServiceListItem(
      moisRaw({ 서비스명: "전세자금대출 이자지원", 서비스분야: "주거", 지원유형: "대출" })
    );
    expect(benefit.topics).toContain("housing");
    expect(benefit.topics).not.toContain("asset_building");
    expect(benefit.financialFacets).toContain("loan");
  });
});

// L. Multi-topic: a benefit can carry more than one genuine purpose, and every
// one of them is independently discoverable via matchesUserInterest — the
// concrete "청년 창업 임대료 지원" example from the audit.
describe("Multi-topic discoverability end-to-end", () => {
  it("a startup benefit filed under a housing-flavored MOIS 서비스분야 is findable under BOTH interests", () => {
    const benefit = normalizeMOISServiceListItem(
      moisRaw({ 서비스명: "청년 창업 임대료 지원", 서비스분야: "주거,창업" })
    );
    expect(benefit.topics).toEqual(expect.arrayContaining(["housing", "startup"]));
    expect(matchesUserInterest(benefit, ["startup"])).toBe(true);
    expect(matchesUserInterest(benefit, ["housing"])).toBe(true);
    expect(matchesUserInterest(benefit, ["childcare"])).toBe(false);
  });
});

// M. Checkpoint 4 centralization review: STARTUP_WORDS/TRANSPORT_WORDS are the
// single source of truth both adapters now import — a benefit with an
// identical title should get an identical startup/transport tag from either
// adapter's derivation path (byte-for-byte-identical keyword lists, unlike
// housing/childcare/education/employment/family, which stay adapter-local).
describe("STARTUP_WORDS / TRANSPORT_WORDS centralization", () => {
  it("both hold the exact same single-word lists relied on by both adapters", () => {
    expect(STARTUP_WORDS).toEqual(["창업"]);
    expect(TRANSPORT_WORDS).toEqual(["교통"]);
  });

  it("MOISAdapter and YouthAdapter both tag startup for the same 창업 title", () => {
    const moisBenefit = normalizeMOISServiceListItem(moisRaw({ 서비스명: "청년전용창업자금" }));
    const youthBenefit = normalizeYouthPolicy(youthRaw({ plcyNm: "청년전용창업자금" }));
    expect(moisBenefit.topics).toContain("startup");
    expect(youthBenefit.topics).toContain("startup");
  });

  it("MOISAdapter and YouthAdapter both tag transport for the same 교통 title", () => {
    const moisBenefit = normalizeMOISServiceListItem(moisRaw({ 서비스명: "청년 교통비 지원" }));
    const youthBenefit = normalizeYouthPolicy(youthRaw({ plcyNm: "청년 교통비 지원" }));
    expect(moisBenefit.topics).toContain("transport");
    expect(youthBenefit.topics).toContain("transport");
  });
});

// N. Checkpoint 4 homonym-exclusion helpers, tested directly (not just
// through an adapter) — see domain/benefit/topics.ts's doc comments for the
// full live-catalog evidence behind each pattern.
describe("hasChildcareSignal — 보육 childcare/business-incubator homonym", () => {
  const CHILDCARE_WORDS = ["보육", "육아", "아동", "출산"];

  it("excludes a bare 보육 match in business-incubator context", () => {
    expect(hasChildcareSignal("창업보육센터 지원", CHILDCARE_WORDS)).toBe(false);
    expect(hasChildcareSignal("기업보육센터 운영", CHILDCARE_WORDS)).toBe(false);
  });

  it("keeps a bare 보육 match with no incubator context", () => {
    expect(hasChildcareSignal("시간제보육 지원", CHILDCARE_WORDS)).toBe(true);
  });

  it("keeps a non-보육 childcare word even in incubator-adjacent text", () => {
    expect(hasChildcareSignal("육아종합지원센터 및 창업보육센터", CHILDCARE_WORDS)).toBe(true);
  });

  it("returns false when no childcare word is present at all", () => {
    expect(hasChildcareSignal("청년 취업지원 프로그램", CHILDCARE_WORDS)).toBe(false);
  });
});

describe("hasHousingSignal — 임대 housing/non-residential-lease homonym", () => {
  const HOUSING_WORDS = ["주거", "주택", "전세", "임대"];

  it("excludes a bare 임대 match in non-residential-lease context (farmland/equipment/commercial)", () => {
    expect(hasHousingSignal("농기계임대사업", HOUSING_WORDS)).toBe(false);
    expect(hasHousingSignal("농지 임대료 지원", HOUSING_WORDS)).toBe(false);
    expect(hasHousingSignal("상가 임대료 감면", HOUSING_WORDS)).toBe(false);
    expect(hasHousingSignal("퇴직예정 교직원 퇴임대비 연수", HOUSING_WORDS)).toBe(false);
  });

  it("keeps a bare 임대 match with no non-residential-lease context", () => {
    expect(hasHousingSignal("임대보증금 지원", HOUSING_WORDS)).toBe(true);
    expect(hasHousingSignal("매입임대 지원(청년)", HOUSING_WORDS)).toBe(true);
  });

  it("keeps a non-임대 housing word even in farm/business-adjacent text", () => {
    expect(hasHousingSignal("농지 임대주택 지원", HOUSING_WORDS)).toBe(true);
  });

  it("returns false when no housing word is present at all", () => {
    expect(hasHousingSignal("청년 취업지원 프로그램", HOUSING_WORDS)).toBe(false);
  });
});

// O. Item 6: for EVERY user-selectable interest (lib/constants/interests.ts),
// matchesUserInterest and matchesBenefitFacet must agree — a single-interest
// call to matchesUserInterest is exactly matchesBenefitFacet for that one
// value, and both must recognize a benefit expressing that interest via
// EVERY channel matchesBenefitFacet documents (direct category, topics
// membership, financialFacets membership) while rejecting an unrelated one.
describe("matchesUserInterest / matchesBenefitFacet consistency — every selectable interest", () => {
  it.each(INTEREST_CATEGORIES)("interest=%s: matchesUserInterest([interest]) === matchesBenefitFacet(interest) for every match channel", (interest: BenefitCategory) => {
    const isFinancialFacet = interest === "loan" || interest === "savings" || interest === "deposit";

    // Channel 1: direct category equality.
    const byCategory = minimalBenefit({ category: interest });
    expect(matchesBenefitFacet(byCategory, interest)).toBe(true);
    expect(matchesUserInterest(byCategory, [interest])).toBe(true);

    // Channel 2: topics membership (category is a DIFFERENT, higher-priority
    // topic, interest is present only as a secondary topic) — doesn't apply
    // to the three financial-facet values, which are never in `topics`.
    if (!isFinancialFacet) {
      const otherCategory: BenefitCategory = interest === "welfare" ? "housing" : "welfare";
      const byTopics = minimalBenefit({ category: otherCategory, topics: [otherCategory as never, interest as never] });
      expect(matchesBenefitFacet(byTopics, interest)).toBe(true);
      expect(matchesUserInterest(byTopics, [interest])).toBe(true);
    }

    // Channel 3: financialFacets membership — only applies to loan/savings/deposit.
    if (isFinancialFacet) {
      const byFacet = minimalBenefit({ category: "housing", financialFacets: [interest as never] });
      expect(matchesBenefitFacet(byFacet, interest)).toBe(true);
      expect(matchesUserInterest(byFacet, [interest])).toBe(true);
    }

    // Negative: a benefit expressing none of the channels never matches.
    const unrelatedCategory: BenefitCategory = interest === "welfare" ? "housing" : "welfare";
    const noMatch = minimalBenefit({ category: unrelatedCategory });
    expect(matchesBenefitFacet(noMatch, interest)).toBe(false);
    expect(matchesUserInterest(noMatch, [interest])).toBe(false);
  });

  it("every INTEREST_CATEGORIES value is a valid BenefitCategory with no duplicates, and deposit is deliberately excluded", () => {
    expect(new Set(INTEREST_CATEGORIES).size).toBe(INTEREST_CATEGORIES.length);
    expect(INTEREST_CATEGORIES).not.toContain("deposit");
    expect(INTEREST_CATEGORIES).toContain("family");
    expect(INTEREST_CATEGORIES).toContain("savings");
    expect(INTEREST_CATEGORIES).toContain("loan");
  });
});
