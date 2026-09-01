import { describe, expect, it } from "vitest";
import {
  detectLogicalConnective,
  extractEligibilityFromText,
} from "@/lib/eligibility/extraction/koreanEligibilityParser";

describe("extractEligibilityFromText", () => {
  it("returns empty result for blank/missing text", () => {
    expect(extractEligibilityFromText("지원대상", undefined)).toEqual({ rules: [], unresolvedClauses: [] });
    expect(extractEligibilityFromText("지원대상", null)).toEqual({ rules: [], unresolvedClauses: [] });
    expect(extractEligibilityFromText("지원대상", "   ")).toEqual({ rules: [], unresolvedClauses: [] });
  });

  it("attaches deterministic_text evidence with the normalized source text", () => {
    const result = extractEligibilityFromText("지원대상", "만\t19세\r이상 34세 이하인 자");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].evidence).toEqual({
      sourceField: "지원대상",
      sourceText: "만 19세 이상 34세 이하인 자",
      extractionType: "deterministic_text",
    });
  });

  // ---------------------------------------------------------------------
  // AGE
  // ---------------------------------------------------------------------
  describe("age", () => {
    it("parses an inclusive 이상/이하 range", () => {
      const { rules } = extractEligibilityFromText("f", "만 19세 이상 34세 이하인 자");
      expect(rules).toEqual([
        expect.objectContaining({ field: "age", operator: "between", value: [19, 34], required: true }),
      ]);
    });

    it("parses a strict 초과/미만 range, adjusting bounds inward by one", () => {
      const { rules } = extractEligibilityFromText("f", "19세 초과 34세 미만인 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "age", operator: "between", value: [20, 33], required: true })
      );
    });

    it("parses a tilde range as inclusive", () => {
      const { rules } = extractEligibilityFromText("f", "19~34세");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "age", operator: "between", value: [19, 34], required: true })
      );
    });

    it("parses a single-sided 이상 bound", () => {
      const { rules } = extractEligibilityFromText("f", "만 19세 이상인 자");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "age", operator: "gte", value: 19 }));
    });

    it("parses a single-sided 초과 bound", () => {
      const { rules } = extractEligibilityFromText("f", "19세 초과인 자");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "age", operator: "gt", value: 19 }));
    });

    it("parses a single-sided 이하 bound", () => {
      const { rules } = extractEligibilityFromText("f", "34세 이하인 자");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "age", operator: "lte", value: 34 }));
    });

    it("parses a single-sided 미만 bound", () => {
      const { rules } = extractEligibilityFromText("f", "34세 미만인 자");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "age", operator: "lt", value: 34 }));
    });

    it("flips the boundary word under adjacent negation (이상하지 않은 -> 미만)", () => {
      const { rules } = extractEligibilityFromText("f", "19세 이상하지 않은 자만 지원");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "age", operator: "lt", value: 19 }));
    });
  });

  // ---------------------------------------------------------------------
  // INCOME
  // ---------------------------------------------------------------------
  describe("income", () => {
    it("defaults bare 연소득 to individualIncomeRange, converting Korean-numeral 만원 to KRW", () => {
      const { rules } = extractEligibilityFromText("f", "연소득 3천만원 이상인 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "individualIncomeRange",
          operator: "range_within",
          value: [30000000, Number.POSITIVE_INFINITY],
        })
      );
    });

    it("routes an explicit 가구 qualifier to householdIncomeRange, converting comma-formatted 만원 to KRW", () => {
      const { rules } = extractEligibilityFromText("f", "가구 연 소득 5,000만원 이하인 가구");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "householdIncomeRange", operator: "range_within", value: [0, 50000000] })
      );
    });

    it("flips 이상 to 미만-equivalent (upper-bounded) under adjacent 하지 않은 negation", () => {
      const { rules } = extractEligibilityFromText("f", "연소득 5000만원 이상하지 않은 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "individualIncomeRange", operator: "range_within", value: [0, 50000000] })
      );
    });

    it("reports 기준 중위소득 clauses as unresolved rather than guessing a threshold", () => {
      const result = extractEligibilityFromText("f", "기준 중위소득 50% 이하 가구");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["기준 중위소득 50% 이하 가구"]);
    });
  });

  // ---------------------------------------------------------------------
  // REGION
  // ---------------------------------------------------------------------
  describe("region", () => {
    it("does nothing when there's no residence keyword", () => {
      const result = extractEligibilityFromText("f", "서울특별시 소재 기업");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([]);
    });

    it("resolves a province-only mention via alias normalization", () => {
      const { rules } = extractEligibilityFromText("f", "서울 거주자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "residence",
          operator: "region_in",
          value: [{ province: "서울특별시" }],
        })
      );
    });

    it("resolves a province + city mention together", () => {
      const { rules } = extractEligibilityFromText("f", "경기도 성남시 거주자");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "residence",
          operator: "region_in",
          value: [{ province: "경기도", city: "성남시" }],
        })
      );
    });

    it("prefers the longest matching province alias (세종특별자치시 over 세종)", () => {
      const { rules } = extractEligibilityFromText("f", "세종특별자치시 거주자");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "residence", value: [{ province: "세종특별자치시" }] })
      );
    });

    it("reports a lone city/county/district mention (no province context) as unresolved", () => {
      const result = extractEligibilityFromText("f", "강남구에 거주하는 자");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["강남구에 거주하는 자"]);
    });
  });

  // ---------------------------------------------------------------------
  // EDUCATION
  // ---------------------------------------------------------------------
  describe("education", () => {
    it("resolves 대학생 또는 대학원생 to the university+graduate_school umbrella", () => {
      const { rules } = extractEligibilityFromText("f", "대학생 또는 대학원생인 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "educationStatus",
          operator: "in",
          value: ["university", "graduate_school"],
        })
      );
    });

    it("resolves 대학원생 alone", () => {
      const { rules } = extractEligibilityFromText("f", "대학원생인 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "educationStatus", operator: "eq", value: "graduate_school" })
      );
    });

    it("resolves 대학생 alone", () => {
      const { rules } = extractEligibilityFromText("f", "대학생인 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "educationStatus", operator: "eq", value: "university" })
      );
    });

    it("resolves 고등학생 alone", () => {
      const { rules } = extractEligibilityFromText("f", "고등학생인 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "educationStatus", operator: "eq", value: "high_school" })
      );
    });

    it("reports a negated 대학생 mention (제외) as unresolved rather than asserting university status", () => {
      const result = extractEligibilityFromText("f", "대학생은 제외한다");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["대학생은 제외한다"]);
    });
  });

  // ---------------------------------------------------------------------
  // EMPLOYMENT
  // ---------------------------------------------------------------------
  describe("employment", () => {
    it("resolves 미취업", () => {
      const { rules } = extractEligibilityFromText("f", "미취업자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "employmentStatus", operator: "eq", value: "unemployed" })
      );
    });

    it("resolves 재직", () => {
      const { rules } = extractEligibilityFromText("f", "재직자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({ field: "employmentStatus", operator: "eq", value: "employed" })
      );
    });

    it("reports a negated 미취업 mention as unresolved", () => {
      const result = extractEligibilityFromText("f", "미취업자는 제외한다");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["미취업자는 제외한다"]);
    });
  });

  // ---------------------------------------------------------------------
  // HOUSING
  // ---------------------------------------------------------------------
  describe("housing", () => {
    it("resolves 무주택 to homeowner:false", () => {
      const { rules } = extractEligibilityFromText("f", "무주택 세대주만 신청 가능");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "homeowner", operator: "eq", value: false }));
    });

    it("resolves an excluded 주택보유자 clause to homeowner:false", () => {
      const { rules } = extractEligibilityFromText("f", "주택보유자는 제외한다");
      expect(rules[0]).toEqual(
        expect.objectContaining({ id: "text-housing-nonowner-excl", field: "homeowner", value: false })
      );
    });

    it("reports a non-excluding 주택 보유자 mention as unresolved (ambiguous: required vs merely permitted)", () => {
      const result = extractEligibilityFromText("f", "주택 보유자만 신청 가능합니다");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["주택 보유자만 신청 가능합니다"]);
    });
  });

  // ---------------------------------------------------------------------
  // BUSINESS OWNERSHIP
  // ---------------------------------------------------------------------
  describe("business ownership", () => {
    it("resolves an explicit non-owner clause", () => {
      const { rules } = extractEligibilityFromText("f", "사업자등록이 없는 자");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "businessOwner", operator: "eq", value: false }));
    });

    it("resolves an explicit owner clause (보유한)", () => {
      const { rules } = extractEligibilityFromText("f", "사업자등록증을 보유한 자");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "businessOwner", operator: "eq", value: true }));
    });

    it("reports an ambiguous 사업자등록 mention as unresolved", () => {
      const result = extractEligibilityFromText("f", "사업자등록 현황을 확인합니다");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["사업자등록 현황을 확인합니다"]);
    });
  });

  // ---------------------------------------------------------------------
  // CHILDREN COUNT
  // ---------------------------------------------------------------------
  describe("children count", () => {
    it("resolves 자녀 N명 이상", () => {
      const { rules } = extractEligibilityFromText("f", "자녀 2명 이상 가구");
      expect(rules[0]).toEqual(expect.objectContaining({ field: "childrenCount", operator: "gte", value: 2 }));
    });
  });

  // ---------------------------------------------------------------------
  // LOGICAL CONNECTIVE / OR SAFETY NET
  // ---------------------------------------------------------------------
  describe("detectLogicalConnective", () => {
    it("detects AND-only signals", () => {
      expect(detectLogicalConnective("아래 요건을 모두 충족하는 자")).toBe("all");
      expect(detectLogicalConnective("만 19세 이상 및 서울 거주자")).toBe("all");
    });

    it("detects OR-only signals", () => {
      expect(detectLogicalConnective("대학생 또는 미취업자")).toBe("any");
      expect(detectLogicalConnective("다음 중 하나에 해당하는 자")).toBe("any");
    });

    it("is unresolved when both or neither signal is present", () => {
      expect(detectLogicalConnective("만 19세 이상인 자")).toBe("unresolved");
      expect(detectLogicalConnective("모두 충족하거나 또는 예외 인정")).toBe("unresolved");
    });
  });

  describe("OR safety net", () => {
    it("bails out to unresolved when 2+ independently-extracted rules co-occur under an explicit OR", () => {
      const result = extractEligibilityFromText("f", "대학생 또는 미취업자에 해당하는 자");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toHaveLength(1);
      expect(result.unresolvedClauses[0]).toContain("대학생");
    });

    it("does NOT bail out when only a single rule is extracted, even if an OR word is present", () => {
      // "미취업자 또는 취업준비생" -> only "미취업" matches our employment
      // pattern; "취업준비생" isn't a recognized pattern on its own, so only
      // one rule is produced and the OR safety net should not apply.
      const result = extractEligibilityFromText("f", "미취업자 또는 취업준비생 지원");
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]).toEqual(expect.objectContaining({ field: "employmentStatus", value: "unemployed" }));
    });

    it("does NOT bail out for an AND-combined multi-dimension clause", () => {
      const result = extractEligibilityFromText("f", "만 19세 이상 34세 이하이며 서울 거주자인 자를 모두 충족");
      expect(result.rules.length).toBeGreaterThanOrEqual(2);
      expect(result.unresolvedClauses).toEqual([]);
    });
  });
});
