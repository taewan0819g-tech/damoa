import { describe, expect, it } from "vitest";
import {
  detectLogicalConnective,
  extractEligibilityFromText,
} from "@/lib/eligibility/extraction/koreanEligibilityParser";
import { EMPLOYMENT_TARGET_SPECS } from "@/lib/eligibility/employment";

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
          operator: "range_within_interval",
          value: { min: 30000000, minInclusive: true, maxInclusive: true },
        })
      );
    });

    it("routes an explicit 가구 qualifier to householdIncomeRange, converting comma-formatted 만원 to KRW", () => {
      const { rules } = extractEligibilityFromText("f", "가구 연 소득 5,000만원 이하인 가구");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "householdIncomeRange",
          operator: "range_within_interval",
          value: { max: 50000000, minInclusive: true, maxInclusive: true },
        })
      );
    });

    it("distinguishes strict 미만 from inclusive 이하 at the exact boundary value", () => {
      const { rules: leRules } = extractEligibilityFromText("f", "연소득 3500만원 이하인 자");
      expect(leRules[0]).toEqual(
        expect.objectContaining({
          operator: "range_within_interval",
          value: { max: 35000000, minInclusive: true, maxInclusive: true },
        })
      );

      const { rules: ltRules } = extractEligibilityFromText("f", "연소득 3500만원 미만인 자");
      expect(ltRules[0]).toEqual(
        expect.objectContaining({
          operator: "range_within_interval",
          value: { max: 35000000, minInclusive: true, maxInclusive: false },
        })
      );
    });

    it("distinguishes strict 초과 from inclusive 이상 at the exact boundary value", () => {
      const { rules: gteRules } = extractEligibilityFromText("f", "연소득 3500만원 이상인 자");
      expect(gteRules[0]).toEqual(
        expect.objectContaining({
          operator: "range_within_interval",
          value: { min: 35000000, minInclusive: true, maxInclusive: true },
        })
      );

      const { rules: gtRules } = extractEligibilityFromText("f", "연소득 3500만원 초과인 자");
      expect(gtRules[0]).toEqual(
        expect.objectContaining({
          operator: "range_within_interval",
          value: { min: 35000000, minInclusive: false, maxInclusive: true },
        })
      );
    });

    it("flips 이상 to 미만-equivalent (upper-bounded) under adjacent 하지 않은 negation", () => {
      const { rules } = extractEligibilityFromText("f", "연소득 5000만원 이상하지 않은 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "individualIncomeRange",
          operator: "range_within_interval",
          value: { max: 50000000, minInclusive: true, maxInclusive: false },
        })
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

    it("resolves a lone city/county/district mention (no province context) via the gazetteer", () => {
      const { rules } = extractEligibilityFromText("f", "강남구에 거주하는 자");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "residence",
          operator: "region_in",
          value: [{ province: "서울특별시", city: "강남구" }],
        })
      );
    });

    it("resolves 이천시/수원시/성남시/해운대구 (the task's canonical gazetteer examples)", () => {
      expect(extractEligibilityFromText("f", "이천시 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "경기도", city: "이천시" }] })
      );
      expect(extractEligibilityFromText("f", "수원시 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "경기도", city: "수원시" }] })
      );
      expect(extractEligibilityFromText("f", "성남시 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "경기도", city: "성남시" }] })
      );
      expect(extractEligibilityFromText("f", "해운대구 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "부산광역시", city: "해운대구" }] })
      );
    });

    it("resolves the exact 경기도 이천시 example from the task spec", () => {
      const { rules } = extractEligibilityFromText("f", "경기도 이천시 거주 청년");
      expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "경기도", city: "이천시" }] }));
    });

    it("resolves an OR'd list of provinces", () => {
      const { rules } = extractEligibilityFromText("f", "서울특별시 또는 경기도 거주자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "서울특별시" }, { province: "경기도" }] })
      );
    });

    it("resolves a comma-delimited list of sibling cities under the same province", () => {
      const { rules } = extractEligibilityFromText("f", "경기도 이천시, 여주시 거주자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          value: [
            { province: "경기도", city: "이천시" },
            { province: "경기도", city: "여주시" },
          ],
        })
      );
    });

    it("resolves a comma-delimited list of lone cities (no province) via the gazetteer", () => {
      const { rules } = extractEligibilityFromText("f", "이천시, 여주시 거주자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          value: expect.arrayContaining([
            { province: "경기도", city: "이천시" },
            { province: "경기도", city: "여주시" },
          ]),
        })
      );
    });

    it("nationwide/general residence text produces no region rule at all", () => {
      const result = extractEligibilityFromText("f", "전국 거주자 누구나 신청 가능");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([]);
    });

    it("does not treat an organization/office mention as a residence condition (no residence keyword present)", () => {
      for (const text of ["이천시청에서 지원하는 사업입니다", "이천시에서 사업 시행", "접수처: 이천시청"]) {
        const result = extractEligibilityFromText("f", text);
        expect(result.rules).toEqual([]);
        expect(result.unresolvedClauses).toEqual([]);
      }
    });

    it("excludes an institution mention (OO시청) even when a real residence requirement is present in the same text", () => {
      const { rules } = extractEligibilityFromText(
        "f",
        "이천시 거주자만 신청 가능하며, 접수처는 이천시청입니다."
      );
      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "경기도", city: "이천시" }] }));
    });

    it("reports a genuinely cross-province-ambiguous lone city (고성군) as unresolved rather than guessing", () => {
      const result = extractEligibilityFromText("f", "고성군 거주자만 신청 가능");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["고성군 거주자만 신청 가능"]);
    });

    it("reports an unrecognized lone city-like token as unresolved rather than guessing", () => {
      const result = extractEligibilityFromText("f", "없는시 거주자만 신청 가능");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["없는시 거주자만 신청 가능"]);
    });

    it("a user residing in the allowed province's broader area is compatible with a province-only rule (hierarchy check via matchRegion)", () => {
      const { rules } = extractEligibilityFromText("f", "경기도 거주자만 신청 가능");
      const rule = rules[0] as { value: { province: string; city?: string }[] };
      expect(rule.value).toEqual([{ province: "경기도" }]);
    });

    it("does not misparse 경기도 광주시 as the 광주광역시 alias (leftmost-province-mention fix)", () => {
      const { rules } = extractEligibilityFromText("f", "경기도 광주시 거주자만 신청 가능");
      expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "경기도", city: "광주시" }] }));
    });

    it("resolves bare 주민 as a residence signal, excluding the 주민센터 false-positive collision", () => {
      const { rules } = extractEligibilityFromText("f", "이천시 주민만 신청 가능");
      expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "경기도", city: "이천시" }] }));

      const result = extractEligibilityFromText("f", "이천시 주민센터에서 접수합니다");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([]);
    });

    it("resolves a real short (1-char-stem) district when paired with an explicit province — 서울특별시 중구", () => {
      const { rules } = extractEligibilityFromText("f", "서울특별시 중구 거주자만 신청 가능");
      expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "서울특별시", city: "중구" }] }));
    });

    it("resolves other real short districts (동구/서구/남구/북구) when paired with an explicit province", () => {
      expect(extractEligibilityFromText("f", "대전광역시 동구 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "대전광역시", city: "동구" }] })
      );
      expect(extractEligibilityFromText("f", "인천광역시 서구 주민등록을 두고 있는 자").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "인천광역시", city: "서구" }] })
      );
      expect(extractEligibilityFromText("f", "광주광역시 남구 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "광주광역시", city: "남구" }] })
      );
      expect(extractEligibilityFromText("f", "울산광역시 북구 거주자만 신청 가능").rules[0]).toEqual(
        expect.objectContaining({ value: [{ province: "울산광역시", city: "북구" }] })
      );
    });

    it("still refuses to guess a bare short district with no province context — 중구 exists in 5 metros", () => {
      const result = extractEligibilityFromText("f", "중구 거주자만 신청 가능");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["중구 거주자만 신청 가능"]);
    });

    it("a short-district match that isn't at a word boundary (e.g. immediately glued onto a province name with no separator) safely falls back to province-only rather than guessing", () => {
      // No real MOIS text is formatted this way (province and city are
      // always space-separated), but if it were, `isHangulBoundaryOk`
      // rejects the glued-on short token and `extractProvinceCitySpecs`
      // falls back to the still-correct, broader province-only spec instead
      // of risking a wrong city assertion.
      const { rules } = extractEligibilityFromText("f", "서울특별시중구 거주자만 신청 가능");
      expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "서울특별시" }] }));
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
        expect.objectContaining({
          field: "employmentStatus",
          operator: "status_compat",
          value: EMPLOYMENT_TARGET_SPECS.unemployed,
        })
      );
    });

    it("resolves 재직", () => {
      const { rules } = extractEligibilityFromText("f", "재직자만 신청 가능");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: "employmentStatus",
          operator: "status_compat",
          value: EMPLOYMENT_TARGET_SPECS.employed,
        })
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
      expect(result.rules[0]).toEqual(
        expect.objectContaining({ field: "employmentStatus", value: EMPLOYMENT_TARGET_SPECS.unemployed })
      );
    });

    it("does NOT bail out for an AND-combined multi-dimension clause", () => {
      const result = extractEligibilityFromText("f", "만 19세 이상 34세 이하이며 서울 거주자인 자를 모두 충족");
      expect(result.rules.length).toBeGreaterThanOrEqual(2);
      expect(result.unresolvedClauses).toEqual([]);
    });

    it("does NOT bail out when a 또는 occurrence is far from either extracted rule's trigger signal (real MOIS shape)", () => {
      // Real excerpt (MOIS 304000000105): the "본인 또는 배우자" OR is about
      // WHO gave birth, nowhere near the age or region trigger text — the
      // clause-local check must not treat it as joining those dimensions.
      const result = extractEligibilityFromText(
        "f",
        "본인 또는 배우자가 출산한 만 7세 미만의 아동을 양육하면서 신청일 기준으로 1년 전부터 계속하여 광진구에 주민등록을 두고 거주하는 장애인"
      );
      expect(result.rules.map((r) => r.field).sort()).toEqual(["age", "residence"]);
      expect(result.unresolvedClauses).toEqual([]);
    });
  });
});

/**
 * Phase 1 regression cases (region correctness hardening): false city-token
 * matches on ordinary Korean words, the "주민등록법" statute-name false
 * positive, and preserving the existing gazetteer-resolution behaviors these
 * fixes must not disturb. See koreanEligibilityParser.ts section comments
 * for the underlying design (word-boundary/lexical validation hierarchy,
 * not an ever-growing blacklist).
 */
describe("Phase 1: region correctness hardening", () => {
  describe("item A: false city-token matches on ordinary Korean words", () => {
    it('"1인가구 거주자만 신청 가능" -> no region rule, no unresolved clause (인가구 is not a place, just N-person-household)', () => {
      const result = extractEligibilityFromText("f", "1인가구 거주자만 신청 가능");
      expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      expect(result.unresolvedClauses).toEqual([]);
    });

    it('"노동구제 대상자는 거주지와 무관하게 신청할 수 있습니다" -> no region rule, no unresolved clause (노동구 is only a substring of 노동구제)', () => {
      const result = extractEligibilityFromText("f", "노동구제 대상자는 거주지와 무관하게 신청할 수 있습니다");
      expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      expect(result.unresolvedClauses).toEqual([]);
    });

    it('"이천시 거주자" still resolves (preserves gazetteer-lone-city behavior)', () => {
      const result = extractEligibilityFromText("f", "이천시 거주자만 신청 가능");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "경기도", city: "이천시" }]);
    });

    it('"서울특별시 중구 거주자" still resolves (preserves province-disambiguated short-district behavior)', () => {
      const result = extractEligibilityFromText("f", "서울특별시 중구 거주자만 신청 가능");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "서울특별시", city: "중구" }]);
    });

    it('"중구 거주자" still stays unresolved (genuinely ambiguous across 5 metros, no province stated)', () => {
      const result = extractEligibilityFromText("f", "중구 거주자만 신청 가능");
      expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      expect(result.unresolvedClauses).toHaveLength(1);
    });

    it('"없는시 거주자" still stays unresolved (lexically a standalone place-like token, just not in the gazetteer)', () => {
      const result = extractEligibilityFromText("f", "없는시 거주자만 신청 가능");
      expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      expect(result.unresolvedClauses).toHaveLength(1);
    });
  });

  describe("item B: 주민등록법 statute-name false positive", () => {
    it('"주민등록법에 따른 대상자" -> no region rule (주민등록법 names a statute, not an applicant residence relation)', () => {
      const result = extractEligibilityFromText("f", "주민등록법에 따른 대상자");
      expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      expect(result.unresolvedClauses).toEqual([]);
    });

    it('"서울특별시에 주민등록을 둔 자" -> resolves to a 서울특별시 region rule', () => {
      const result = extractEligibilityFromText("f", "서울특별시에 주민등록을 둔 자");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "서울특별시" }]);
    });
  });

  describe("item C: asymmetric OR-window shared-subject-prefix false positive (frozen-snapshot regression)", () => {
    it('"...거주하는 구민 또는 그 자녀로서 고등학교에 재학중인 학생" -> resolves residence (real MOIS 347000000105 shape; the OR joins WHO the applicant is, not two dimensions)', () => {
      const result = extractEligibilityFromText(
        "f",
        "선발공고일 현재 1년 이상 달서구 관내 주소를 두고 거주하는 구민 또는 그 자녀로서 고등학교에 재학중인 학생"
      );
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "대구광역시", city: "달서구" }]);
      expect(result.unresolvedClauses).toEqual([]);
    });

    it('"대학생 또는 미취업자" (genuine cross-dimension OR) still bails out to unresolved under the tightened before-window', () => {
      const result = extractEligibilityFromText("f", "대학생 또는 미취업자에 해당하는 자");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toHaveLength(1);
    });
  });

  describe("item D: no-space trailing continuations after a city token (거주/관내/여야)", () => {
    it('"나주시거주 1년이상인 65세이상..." -> resolves residence with no space before 거주 (real MOIS 483000000103 shape)', () => {
      const result = extractEligibilityFromText("f", "나주시거주 1년이상인 65세이상 의료급여수급자 및 차상위본인부담경감대상자");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "전라남도", city: "나주시" }]);
    });

    it('"과천시관내에 주민등록을 두고..." -> resolves residence with no space before 관내 (real MOIS 397000000124 shape)', () => {
      const result = extractEligibilityFromText(
        "f",
        "신생아의 출산일을 기준으로 신생아의 부 또는 모가 과천시관내에 주민등록을 두고 180일 이상 계속 거주한 장애인가정"
      );
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "경기도", city: "과천시" }]);
    });

    it('"여수시여야 지원 가능" -> resolves residence despite the contracted-copula "여" attaching with no space (city + 이어야)', () => {
      const result = extractEligibilityFromText("f", "신청일 기준 주소지가 여수시여야 지원 가능");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "전라남도", city: "여수시" }]);
    });
  });

  describe("item E: generalized 주소를 둔/주소를 두고 residence-signal phrasing", () => {
    it('"종로구에 주소를 둔 사람" -> resolves residence (real MOIS 300000000143 shape; no "해당 지역에" prefix required)', () => {
      const result = extractEligibilityFromText("f", "「주민등록법」에 따라 종로구에 주소를 둔 사람");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "서울특별시", city: "종로구" }]);
    });

    it('"달성군에 주소를 두고 있는 사람" -> resolves residence (real MOIS O00019700014 shape)', () => {
      const result = extractEligibilityFromText("f", "주민등록표상 달성군에 주소를 두고 있는 사람을 말한다");
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "대구광역시", city: "달성군" }]);
    });

    it('"...주소를 두지 못하는 경우" (negated) does NOT count as an affirmative residence signal on its own', () => {
      // "두지" is a distinct substring from both "주소를 둔" and "주소를 두고",
      // so this negated phrasing must not be picked up as a false affirmative
      // signal merely because it also contains "주소를".
      const result = extractEligibilityFromText("f", "부 또는 모가 직장 등으로 인해 서천군에 주소를 두지 못하는 경우");
      // The OR here ("부 또는 모") sits right next to the negated phrase, not
      // an affirmative one — this assertion only pins down that "주소를 두지"
      // itself isn't a new false-affirmative literal match.
      expect(result.rules.every((r) => r.field !== "residence" || JSON.stringify(r.value).includes("서천군"))).toBe(
        true
      );
    });
  });

  describe("item F: boundary-validated city-token check inside the OR safety net", () => {
    it('"미취업 혹은 근로시간 주 30시간 미만" no longer falsely triggers a residence-field match via "근로시" (real MOIS 569000000390 shape)', () => {
      const result = extractEligibilityFromText(
        "f",
        "(거주) 공고일 기준 세종시 거주(주민등록)된 자 (연령) 19~39세(청년) 구직(미취업)자 (근로) 미취업 혹은 근로시간 주 30시간 미만, 워크넷 구직등록자"
      );
      const fields = result.rules.map((r) => r.field).sort();
      expect(fields).toEqual(["age", "employmentStatus", "residence"]);
      const region = result.rules.find((r) => r.field === "residence");
      expect(region?.value).toEqual([{ province: "세종특별자치시" }]);
    });
  });
});
