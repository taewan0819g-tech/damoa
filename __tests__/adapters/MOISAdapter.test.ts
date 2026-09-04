import { describe, expect, it } from "vitest";
import {
  normalizeMOISServiceListItem,
  normalizeMOISServiceDetail,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawServiceDetail,
} from "@/adapters/mois/MOISAdapter";

function rawListItem(overrides: Partial<MOISRawServiceListItem>): MOISRawServiceListItem {
  return {
    서비스ID: "1",
    서비스명: "Test Service",
    소관기관명: "Test Org",
    ...overrides,
  };
}

function rawDetail(overrides: Partial<MOISRawServiceDetail>): MOISRawServiceDetail {
  return {
    서비스ID: "1",
    서비스명: "Test Service",
    소관기관명: "Test Org",
    ...overrides,
  };
}

describe("normalizeMOISServiceListItem eligibility", () => {
  it("builds no eligibility group and no incompleteness flags when nothing is present", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({}));
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.eligibilityDataStatus).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(false);
  });

  it("carries through the age rule from supportConditions and marks the result incomplete", () => {
    const ageEligibility = normalizeMOISSupportConditions({ 서비스ID: "1", JA0110: 19, JA0111: 34 });
    const benefit = normalizeMOISServiceListItem(rawListItem({}), ageEligibility);
    expect(benefit.eligibility).toEqual({
      type: "all",
      rules: [{ id: "mois-age", field: "age", operator: "between", value: [19, 34], required: true }],
    });
    expect(benefit.eligibilityDataStatus).toBe("incomplete");
    expect(benefit.hasUnresolvedEligibility).toBe(false);
  });

  it("adds a target_scope_in rule from a recognized 사용자구분 value, with structured_api evidence", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 사용자구분: "개인" }));
    expect(benefit.eligibility?.rules).toEqual([
      expect.objectContaining({
        id: "mois-user-scope",
        operator: "target_scope_in",
        value: ["individual"],
        evidence: { sourceField: "사용자구분", sourceText: "개인", extractionType: "structured_api" },
      }),
    ]);
    expect(benefit.hasUnresolvedEligibility).toBe(false);
  });

  it("decodes an OR-combined 사용자구분 value", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 사용자구분: "소상공인||법인/시설/단체" }));
    expect(benefit.eligibility?.rules).toEqual([
      expect.objectContaining({ operator: "target_scope_in", value: ["small_business_owner", "corporate"] }),
    ]);
  });

  it("flags an unrecognized 사용자구분 token as unresolved instead of guessing", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 사용자구분: "외국인" }));
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("parses 지원대상 free text into a rule with deterministic_text evidence", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 지원대상: "만 19세 이상 34세 이하인 자" }));
    expect(benefit.eligibility?.rules).toEqual([
      expect.objectContaining({
        field: "age",
        operator: "between",
        value: [19, 34],
        evidence: expect.objectContaining({ sourceField: "지원대상", extractionType: "deterministic_text" }),
      }),
    ]);
  });

  it("parses a proven-safe 기준 중위소득 household-income 선정기준 clause into a median_income_threshold rule (checkpoint-3)", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 선정기준: "가구소득 기준 중위소득 50% 이하 가구" }));
    expect(benefit.eligibility?.rules).toEqual([
      expect.objectContaining({
        field: "householdIncomeRange",
        operator: "median_income_threshold",
        value: expect.objectContaining({ percent: 50, boundary: "lte", incomeMetric: "household_income" }),
      }),
    ]);
    expect(benefit.hasUnresolvedEligibility).toBe(false);
  });

  it("flags an unresolved 선정기준 clause (e.g. 소득인정액-qualified 중위소득) via hasUnresolvedEligibility", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 선정기준: "소득인정액이 기준 중위소득 50% 이하 가구" }));
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("merges age (supportConditions) + target scope (사용자구분) + text (지원대상) into one 'all' group", () => {
    const ageEligibility = normalizeMOISSupportConditions({ 서비스ID: "1", JA0110: 19, JA0111: 34 });
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 사용자구분: "개인", 지원대상: "서울 거주자만 신청 가능" }),
      ageEligibility
    );
    expect(benefit.eligibility?.type).toBe("all");
    expect(benefit.eligibility?.rules).toHaveLength(3);
    const operators = benefit.eligibility?.rules.map((r) => (r as { operator: string }).operator);
    expect(operators).toEqual(expect.arrayContaining(["between", "target_scope_in", "region_in"]));
  });
});

describe("normalizeMOISServiceDetail eligibility", () => {
  it("does not crash on a detail record (사용자구분 not in its declared shape) and produces no scope rule", () => {
    const benefit = normalizeMOISServiceDetail(rawDetail({ 지원대상: "무주택 세대주만 신청 가능" }));
    expect(benefit.eligibility?.rules).toEqual([
      expect.objectContaining({ field: "homeowner", operator: "eq", value: false }),
    ]);
  });

  it("still merges an age rule passed in from the shared supportConditions map", () => {
    const ageEligibility = normalizeMOISSupportConditions({ 서비스ID: "1", JA0110: 20, JA0111: 39 });
    const benefit = normalizeMOISServiceDetail(rawDetail({}), ageEligibility);
    expect(benefit.eligibility).toEqual({
      type: "all",
      rules: [{ id: "mois-age", field: "age", operator: "between", value: [20, 39], required: true }],
    });
    expect(benefit.eligibilityDataStatus).toBe("incomplete");
  });
});

describe("신청기한 -> application.startDate/endDate/deadlineType", () => {
  it("normalizeMOISServiceListItem maps a parseable date range into startDate/endDate", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 신청기한: "2025.04.01~2026.03.31" }));
    expect(benefit.application).toEqual(
      expect.objectContaining({
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        deadlineType: "date_range",
      })
    );
  });

  it("normalizeMOISServiceListItem tags 상시/연중/수시/채용시 text as open_ended without inventing dates", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 신청기한: "상시모집" }));
    expect(benefit.application?.startDate).toBeUndefined();
    expect(benefit.application?.endDate).toBeUndefined();
    expect(benefit.application?.deadlineType).toBe("open_ended");
  });

  it("normalizeMOISServiceListItem tags 예산 소진 시 text as budget_exhaustion without inventing dates", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 신청기한: "예산 소진 시 조기 마감" }));
    expect(benefit.application?.startDate).toBeUndefined();
    expect(benefit.application?.endDate).toBeUndefined();
    expect(benefit.application?.deadlineType).toBe("budget_exhaustion");
  });

  it("normalizeMOISServiceListItem leaves ambiguous free text unparsed (date_unknown-equivalent), never guessing a date", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 신청기한: "대출 약정희망일의 전월 25일까지" }));
    expect(benefit.application?.startDate).toBeUndefined();
    expect(benefit.application?.endDate).toBeUndefined();
    expect(benefit.application?.deadlineType).toBe("unparsed");
  });

  it("normalizeMOISServiceListItem leaves a missing 신청기한 unparsed", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({}));
    expect(benefit.application?.startDate).toBeUndefined();
    expect(benefit.application?.endDate).toBeUndefined();
    expect(benefit.application?.deadlineType).toBe("unparsed");
  });

  it("normalizeMOISServiceDetail maps a parseable date range into startDate/endDate too", () => {
    const benefit = normalizeMOISServiceDetail(rawDetail({ 신청기한: "2026-05-04 ~ 2026-05-20" }));
    expect(benefit.application).toEqual(
      expect.objectContaining({
        startDate: "2026-05-04",
        endDate: "2026-05-20",
        deadlineType: "date_range",
      })
    );
  });

  it("normalizeMOISServiceDetail tags open-ended text the same way as the list-item normalizer", () => {
    const benefit = normalizeMOISServiceDetail(rawDetail({ 신청기한: "수시" }));
    expect(benefit.application?.deadlineType).toBe("open_ended");
    expect(benefit.application?.startDate).toBeUndefined();
  });
});

// Checkpoint 4 cross-topic precision audit regressions — see
// docs/audits/cross-topic-precision-audit.json and
// domain/benefit/topics.ts's UNSAFE_COMBINED_SEOBISBUNYA /
// hasChildcareSignal / hasHousingSignal doc comments for the full
// live-catalog evidence behind each of these.
describe("MOISAdapter — 서비스분야 combined-bucket exclusion (UNSAFE_COMBINED_SEOBISBUNYA)", () => {
  it("does not tag childcare from the combined 보육·교육 field alone when the title is pure adult education", () => {
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 서비스명: "인문100년장학금", 서비스분야: "보육·교육" })
    );
    expect(benefit.topics).not.toContain("childcare");
    expect(benefit.topics).toContain("education");
  });

  it("does not tag startup from the combined 고용·창업 field alone when the title is pure employment", () => {
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 서비스명: "선원복지고용센터 운영", 서비스분야: "고용·창업" })
    );
    expect(benefit.topics).not.toContain("startup");
    expect(benefit.topics).toContain("employment");
  });

  it("does not tag housing from the combined 주거·자립 field alone when the title is unrelated self-reliance support", () => {
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 서비스명: "북한이탈주민 자산형성 지원 (미래행복통장)", 서비스분야: "주거·자립" })
    );
    expect(benefit.topics).not.toContain("housing");
  });

  it("still tags childcare/startup/housing when the title itself independently supports it, even under a combined field", () => {
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 서비스명: "영유아보육료 지원", 서비스분야: "보육·교육" })
    );
    expect(benefit.topics).toContain("childcare");
  });

  it("still scans a SAFE (non-combined) 서비스분야 value normally, e.g. 임신·출산 for a childcare-adjacent title", () => {
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 서비스명: "고위험 임산부 의료비 지원", 서비스분야: "임신·출산" })
    );
    expect(benefit.topics).toContain("childcare");
  });
});

describe("MOISAdapter — 보육 childcare/business-incubator homonym fix", () => {
  it("does NOT tag childcare for a business-incubation-center program", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "장애인기업 창업보육센터 운영" }));
    expect(benefit.topics).not.toContain("childcare");
    expect(benefit.topics).toContain("startup");
  });

  it("DOES still tag childcare for a genuine childcare-facility program using the bare 보육 word", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "시간제보육 지원" }));
    expect(benefit.topics).toContain("childcare");
  });
});

describe("MOISAdapter — 임대 housing/non-residential-lease homonym fix", () => {
  it("does NOT tag housing for a farm-equipment lease program", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "농기계임대사업" }));
    expect(benefit.topics).not.toContain("housing");
  });

  it("does NOT tag housing for a farmland-lease program", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "청년후계농 농지 임대료 지원" }));
    expect(benefit.topics).not.toContain("housing");
  });

  it("does NOT tag housing for a commercial storefront-lease discount", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "구서시티타워상가 임대료 감면" }));
    expect(benefit.topics).not.toContain("housing");
  });

  it("does NOT tag housing for the coincidental 퇴임대비 substring collision", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "퇴직예정 교직원 퇴임대비 연수" }));
    expect(benefit.topics).not.toContain("housing");
  });

  it("DOES still tag housing for a genuine rental-deposit support program", () => {
    const benefit = normalizeMOISServiceListItem(
      rawListItem({ 서비스명: "전북특별자치도 신혼부부 및 청년 임대보증금 지원사업" })
    );
    expect(benefit.topics).toContain("housing");
  });

  it("DOES still tag housing for a genuine purchased-rental public housing program (매입임대)", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "매입임대 지원(청년)" }));
    expect(benefit.topics).toContain("housing");
  });

  it("DOES still tag housing when a non-homonym housing word is present regardless of 임대 context", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 서비스명: "농지 임대주택 지원" }));
    expect(benefit.topics).toContain("housing");
  });
});
