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

  it("flags an unresolved 선정기준 clause (e.g. 기준 중위소득) via hasUnresolvedEligibility", () => {
    const benefit = normalizeMOISServiceListItem(rawListItem({ 선정기준: "기준 중위소득 50% 이하 가구" }));
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
