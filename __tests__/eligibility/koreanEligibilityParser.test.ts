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

    it("parses a proven-safe 기준 중위소득 household-income clause into a median_income_threshold rule", () => {
      const result = extractEligibilityFromText("f", "가구소득 기준 중위소득 50% 이하");
      expect(result.unresolvedClauses).toEqual([]);
      expect(result.rules).toEqual([
        expect.objectContaining({
          field: "householdIncomeRange",
          operator: "median_income_threshold",
          required: true,
          value: {
            percent: 50,
            boundary: "lte",
            incomeMetric: "household_income",
            householdSizeMode: "scales_with_profile_household",
          },
        }),
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // MEDIAN INCOME (기준중위소득) — checkpoint-3 proven-safe subset
  // ---------------------------------------------------------------------
  describe("median income (기준중위소득)", () => {
    it("parses each boundary word to the matching MedianIncomeBoundary", () => {
      const cases: [string, string][] = [
        ["가구소득 기준중위소득 50% 이하인 가구", "lte"],
        ["가구소득 기준중위소득 50% 미만인 가구", "lt"],
        ["가구소득 기준중위소득 50% 이상인 가구", "gte"],
        ["가구소득 기준중위소득 50% 초과인 가구", "gt"],
      ];
      for (const [text, boundary] of cases) {
        const { rules } = extractEligibilityFromText("f", text);
        expect(rules).toEqual([
          expect.objectContaining({
            operator: "median_income_threshold",
            value: expect.objectContaining({ boundary }),
          }),
        ]);
      }
    });

    // Real-MOIS finding (frozen-snapshot audit): 203 of 881 total 중위소득
    // mentions in the frozen snapshot drop the "기준" prefix entirely (real
    // examples: 서비스ID 383000000146 "중위소득 120% 미만", 135200000102 "중위소득
    // 60% 이하"). Before this fix, MEDIAN_INCOME_RE required "기준중위소득"
    // literally, so these clauses were invisible to the parser -- not even
    // reported as unresolved, silently vanishing instead. Bare "중위소득" must
    // be extracted exactly like "기준중위소득".
    it("extracts a bare '중위소득' clause with no '기준' prefix (real MOIS wording variant)", () => {
      const { rules, unresolvedClauses } = extractEligibilityFromText(
        "f",
        "가구소득 중위소득 120% 미만 사회적 배려계층 우선지원"
      );
      expect(unresolvedClauses).toEqual([]);
      expect(rules).toEqual([
        expect.objectContaining({
          operator: "median_income_threshold",
          value: expect.objectContaining({
            percent: 120,
            boundary: "lt",
            incomeMetric: "household_income",
            householdSizeMode: "scales_with_profile_household",
          }),
        }),
      ]);
    });

    it("flips the boundary under adjacent negation (이하하지 않은 -> 초과)", () => {
      const { rules } = extractEligibilityFromText("f", "가구소득 기준중위소득 50% 이하하지 않은 가구");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          operator: "median_income_threshold",
          value: expect.objectContaining({ boundary: "gt" }),
        })
      );
    });

    it("rejects an out-of-range percent (0 or > 500) as unresolved", () => {
      const zero = extractEligibilityFromText("f", "기준중위소득 0% 이하인 가구");
      expect(zero.rules).toEqual([]);
      expect(zero.unresolvedClauses).toEqual(["기준중위소득 0% 이하인 가구"]);

      const tooBig = extractEligibilityFromText("f", "기준중위소득 600% 이하인 가구");
      expect(tooBig.rules).toEqual([]);
      expect(tooBig.unresolvedClauses).toEqual(["기준중위소득 600% 이하인 가구"]);
    });

    it.each([
      "소득인정액",
      "건강보험료",
      "건보료",
      "개인소득",
      "본인소득",
      "본인 소득",
      "종합소득",
      // Whitespace-irregular real-MOIS variants (see 서비스ID 134200000003,
      // 643000000730 in the frozen snapshot) — the disqualifier check must
      // be whitespace-tolerant, not a literal-substring match.
      "소득 인정액",
      "소득인 정액",
    ])("leaves the clause unresolved when %s appears near the anchor (different income metric)", (disqualifier) => {
      const text = `${disqualifier} 기준중위소득 50% 이하인 가구`;
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    it("routes a 소득인정액 clause phrased AFTER the percent/boundary through the same disqualifier window", () => {
      const text = "기준중위소득 50% 이하의 소득인정액 가구";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    // Real-MOIS finding (checkpoint-4 review, 서비스ID 553000000106): "건강보험료"
    // misspelled as "건겅보험료" (강->겅) evades a literal-substring disqualifier
    // check entirely.
    it("still disqualifies a health-insurance-premium clause with a real observed typo (건겅보험료 for 건강보험료)", () => {
      const text = "가구건겅보험료 본인부담금 합산액이 기준중위소득 80% 이하인 자";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    // Real-MOIS finding (서비스ID 627000000136, 628000000748): "본인" used as an
    // explicit label directly modifying 기준중위소득 marks an INDIVIDUAL income
    // threshold, not a household one -- must not be typed as household_income.
    it("leaves a '본인' (individual, not household) median-income clause unresolved", () => {
      const text = "- (본인) 기준중위소득 120% 이하 - (가구) 기준중위소득 140% 이하";
      const result = extractEligibilityFromText("f", text);
      // Neither the individual-scoped "(본인)" clause nor the second "(가구)"
      // clause (which the first clause's disqualifier window can still reach,
      // being only ~15 chars away) is safely extracted from this combined
      // sentence; both fall back to unresolved rather than risk mixing up
      // which percent belongs to which scope.
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses.length).toBeGreaterThan(0);
    });

    // Checkpoint-5 (external-review correction): "본인·배우자 합산" (applicant +
    // spouse COMBINED income) is NOT necessarily identical to full household
    // income -- a household may contain other income-earning members beyond
    // the couple (adult children, parents, etc). This used to be treated as
    // a legitimate household-income shape; it is now a dedicated
    // couple-income disqualifier (`MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE`)
    // and must fall back to unresolved, matching real MOIS examples such as
    // 서비스ID 373000000116/402000000115/535000000607/519000000153.
    it("leaves a '본인·배우자 합산' (couple, not full household) median-income clause unresolved", () => {
      const result = extractEligibilityFromText("f", "본인·배우자 합산 연소득이 기준 중위소득 180% 이하");
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual(["본인·배우자 합산 연소득이 기준 중위소득 180% 이하"]);
    });

    // Checkpoint-5: bare "부부합산(연)?소득" phrasing (no explicit "본인·배우자")
    // must be caught the same way -- real examples 서비스ID 373000000116
    // ("부부합산소득이 기준중위소득 200%..."), 402000000115 ("부부합산 소득 기준
    // 중위소득 180% 이하"), 535000000607 ("부부합산 연소득 기준 중위소득 180% 이하").
    it.each(["부부합산소득", "부부합산 소득", "부부합산 연소득"])(
      "leaves a '%s 기준중위소득 N% 이하' couple-income clause unresolved",
      (phrase) => {
        const text = `${phrase}이 기준중위소득 180% 이하`;
        const result = extractEligibilityFromText("f", text);
        expect(result.rules).toEqual([]);
        expect(result.unresolvedClauses).toEqual([text]);
      }
    );

    // Checkpoint-5: the applicant's own wage/earned income (임금/근로소득) is
    // NOT household income -- real example 서비스ID 515000000168 ("임금이
    // 2026년 기준 중위소득 150% 이하인 자"), previously mis-typed as
    // household_income before this fix.
    it.each(["임금", "근로소득", "근로 소득"])(
      "leaves a '%s' (individual wage/earned income) median-income clause unresolved",
      (phrase) => {
        const text = `${phrase}이 기준중위소득 150% 이하인 자`;
        const result = extractEligibilityFromText("f", text);
        expect(result.rules).toEqual([]);
        expect(result.unresolvedClauses).toEqual([text]);
      }
    );

    // Checkpoint-6 (Phase 3 pre-merge, 42-hit manual review of bucket A --
    // see docs/median-income-42-hit-review.md): 소득평가액 (income-assessment
    // amount) is the pre-asset-conversion component of 소득인정액 under
    // Korean welfare law -- an administrative metric, not raw household
    // income. Real example 서비스ID 654000000006 ("가구소득평가액이
    // 기준중위소득 50%이하") was wrongly emitting a household-income rule
    // before this fix, purely because "가구...소득" satisfied the positive
    // regex and no disqualifier recognized "소득평가액" specifically.
    it("leaves a '소득평가액' (income-assessment amount, not raw household income) median-income clause unresolved", () => {
      const text = "가구소득평가액이 기준중위소득 50%이하";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    // Checkpoint-6: 원가구 (the youth applicant's PARENTAL-origin household,
    // e.g. "청년 + 부모 + 부모와 동일 주소") is distinct from the applicant's
    // own 독립가구 (independent household) and from Damoa's
    // `annualHouseholdIncome` (the applicant's own current household).  Real
    // youth-housing programs test BOTH via AND (서비스ID 161300000099,
    // 628000000155) -- neither figure is safely comparable, so the clause
    // must stay unresolved rather than misapplying either threshold.
    it("leaves a '원가구' (parental-origin household, not applicant's own household) median-income clause unresolved", () => {
      const text = "청년 원가구*의 소득이 기준 중위소득 100% 이하이면서 청년 독립가구 소득이 기준 중위소득 60% 이하";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    // Checkpoint-6: "지원가구" (supported household -- an unrelated, common
    // administrative term) must NOT be caught by the 원가구 disqualifier
    // merely because it also ends in "원가구"-like characters ("지" + "원가구"
    // reads as "지원" + "가구" = "supported household", nothing to do with
    // the youth's parental-origin household). The negative lookbehind for
    // "지" exists specifically to avoid this collision.
    it("does NOT falsely disqualify '지원가구' (supported household) as if it were '원가구'", () => {
      const { rules, unresolvedClauses } = extractEligibilityFromText(
        "f",
        "가구소득이 지원가구 기준중위소득 100% 이하인 가구"
      );
      expect(unresolvedClauses).toEqual([]);
      expect(rules[0]).toEqual(
        expect.objectContaining({
          operator: "median_income_threshold",
          value: expect.objectContaining({ percent: 100, boundary: "lte", incomeMetric: "household_income" }),
        })
      );
    });

    // Checkpoint-6: `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE`'s bounded
    // wildcard gap ("가구" ... [^\n]{0,4} ... "소득") could accidentally
    // bridge INTO the trailing "소득" of "중위소득" itself, producing a false
    // positive-signal match even when no genuine household-income phrase is
    // present anywhere in the text. Real examples: 서비스ID 315000000104
    // ("저소득 한부모가구(중위소득65% 이하)" -- no household-income label at
    // all, "가구(중위소득"'s own "소득" is what the old regex wrongly grabbed)
    // and 373000000126 ("전국가구 중위소득의 120%이하" -- "전국가구" is a
    // national reference population, not the applicant's own household).
    it.each([
      ["저소득 한부모가구(중위소득65% 이하) 지원", "315000000104"],
      ["전국가구 중위소득의 120%이하", "373000000126"],
      ["한부모가구, 중위소득 80%이하의 저소득 가구 등", "O00030500005"],
    ])(
      "does NOT treat '가구...중위소득' bridging as a positive household-income signal (%s, real 서비스ID %s)",
      (text) => {
        const result = extractEligibilityFromText("f", text);
        // Two of the three real excerpts also contain "한부모" (single
        // parent), which correctly co-extracts an unrelated
        // singleParentFamily rule from the same text -- that's expected and
        // proves the median-income disqualification doesn't block unrelated
        // family-dimension extraction (same pattern as the existing
        // 소득인정액 disqualifier test above). Only the median-income rule
        // itself must be absent.
        const medianIncomeRules = result.rules.filter((r) => r.operator === "median_income_threshold");
        expect(medianIncomeRules).toEqual([]);
        expect(result.unresolvedClauses).toEqual([text]);
      }
    );

    // Checkpoint-6: confirms the collision fix does NOT break genuine
    // "가구 기준중위소득 ... 가구 소득합산액" style clauses where the gap
    // between "가구" and "소득" does not pass through "중위" at all -- real
    // example 서비스ID 627000000128.
    it("still extracts a genuine '가구 기준중위소득 N% 이하(가구 소득합산액 기준)' rule after the collision fix", () => {
      const text = "가구 기준중위소득 150% 이하(가구 소득합산액 기준)";
      const { rules, unresolvedClauses } = extractEligibilityFromText("f", text);
      expect(unresolvedClauses).toEqual([]);
      expect(rules[0]).toEqual(
        expect.objectContaining({
          operator: "median_income_threshold",
          value: expect.objectContaining({ percent: 150, boundary: "lte", incomeMetric: "household_income" }),
        })
      );
    });

    // Checkpoint-6: the disqualifier-only check window was widened from
    // matchIndex+full.length+20 to +150 chars, because a real trailing
    // "* 소득기준 : ... 소득인정액" footnote can sit further past the anchor
    // than the narrow window used for the positive-signal check. Real
    // example 서비스ID 461000000126 (치매 진료비 및 약제비 본인부담금 지원):
    // the genuine positive-signal label ("신청가구의 소득") is itself INSIDE
    // this same trailing footnote, so a naive "just widen everything"
    // fix would still be unsafe if it also widened the positive-signal
    // window uniformly -- this widens ONLY the disqualifier check.
    it("reaches a disqualifying '소득인정액' footnote beyond the narrow +20 window (widened disqualifier-only window)", () => {
      const text =
        "(소득기준) 기준중위소득 140% 초과자 * 소득기준 : 신청가구의 소득과 재산을 조사하여 산출한 소득인정액을 기준으로 합니다";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    // Checkpoint-5 (the core fix): a bare percent+boundary clause with NO
    // disqualifier AND no explicit positive household-income label is now
    // `ambiguous_unqualified`, not silently assumed to be household income.
    // An empirical frozen-snapshot survey found 774/881 (~88%) of all real
    // 중위소득 anchor hits are exactly this shape.
    it("bare percent+boundary with no positive household-income label nearby -> unresolved (checkpoint-5 core fix)", () => {
      const text = "기준중위소득 100% 이하인 자";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    // ...but an explicit positive household-income label DOES unlock
    // extraction, via any of the recognized label variants.
    it.each(["가구소득", "가구원 소득", "가구의 소득", "세대소득", "세대원 소득"])(
      "extracts a rule when '%s' (positive household-income label) is present nearby",
      (label) => {
        const text = `${label} 기준중위소득 100% 이하인 가구`;
        const { rules, unresolvedClauses } = extractEligibilityFromText("f", text);
        expect(unresolvedClauses).toEqual([]);
        expect(rules[0]).toEqual(
          expect.objectContaining({
            operator: "median_income_threshold",
            value: expect.objectContaining({ percent: 100, boundary: "lte", incomeMetric: "household_income" }),
          })
        );
      }
    );

    // "가구단위 중위소득" (the anchor itself explicitly framed as a
    // household-unit figure) is also a recognized positive signal, even
    // without a separate "OO소득" label -- real example 서비스ID 149200005007
    // ("가구단위 중위소득 100% 이하").
    it("extracts a rule when the anchor itself is explicitly framed as household-unit ('가구단위 중위소득')", () => {
      const { rules, unresolvedClauses } = extractEligibilityFromText("f", "가구단위 중위소득 100% 이하");
      expect(unresolvedClauses).toEqual([]);
      expect(rules[0]).toEqual(
        expect.objectContaining({
          operator: "median_income_threshold",
          value: expect.objectContaining({ percent: 100, boundary: "lte", incomeMetric: "household_income" }),
        })
      );
    });

    it("no household-size number nearby -> scales_with_profile_household", () => {
      const { rules } = extractEligibilityFromText("f", "가구소득 기준중위소득 100% 이하인 가구");
      expect(rules[0]).toEqual(
        expect.objectContaining({
          value: expect.objectContaining({ householdSizeMode: "scales_with_profile_household" }),
        })
      );
      expect((rules[0].value as { fixedHouseholdSize?: number }).fixedHouseholdSize).toBeUndefined();
    });

    // A manual real-MOIS review (docs/median-income-fixed-reference-review.md)
    // found that "exactly one nearby household-size number" is NOT a safe
    // `fixed_reference_household` signal on its own -- most real hits with
    // this shape turned out to be a truncated per-size table or a
    // population-description coincidence, not a genuine fixed-reference
    // design. This parser no longer ever emits `fixed_reference_household`
    // on its own; ANY nearby household-size number (one or many) is
    // unresolved. `fixed_reference_household` stays a valid hand-authored
    // spec shape (see domain/medianIncome/evaluate.ts tests).
    it("exactly one distinct household-size number nearby -> unresolved (not a safe fixed-reference signal)", () => {
      const text = "4인가구 기준 기준중위소득 60% 이하";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    it("two or more distinct household-size numbers nearby -> unresolved (table-like text)", () => {
      const text = "1인가구 100만원, 2인가구 150만원, 기준중위소득 50% 이하";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    it("repeated mentions of the SAME household size nearby are still unresolved (not treated as safely fixed)", () => {
      const text = "4인가구 4인 가구 기준중위소득 60% 이하";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    it("an explicit per-household-size table marker nearby -> unresolved even with zero digit household-size mentions in window", () => {
      const text = "가구원 수에 따라 기준금액이 상이하며 기준중위소득 100% 이하인 가구";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    it("extracts an explicit year stated before the anchor", () => {
      const { rules } = extractEligibilityFromText("f", "가구소득 2026년 기준중위소득 80% 이하인 가구");
      expect(rules[0]).toEqual(expect.objectContaining({ value: expect.objectContaining({ year: 2026 }) }));
    });

    it("extracts an explicit year stated after the anchor", () => {
      const { rules } = extractEligibilityFromText("f", "가구소득 기준중위소득 2026년 80% 이하인 가구");
      expect(rules[0]).toEqual(expect.objectContaining({ value: expect.objectContaining({ year: 2026 }) }));
    });

    it("omits year when none is stated nearby (resolved at evaluation time instead)", () => {
      const { rules } = extractEligibilityFromText("f", "가구소득 기준중위소득 80% 이하인 가구");
      expect((rules[0].value as { year?: number }).year).toBeUndefined();
    });

    it("no percent+boundary near the anchor -> unresolved, not silently dropped", () => {
      const text = "기준중위소득을 고려하여 지원 여부를 결정한다";
      const result = extractEligibilityFromText("f", text);
      expect(result.rules).toEqual([]);
      expect(result.unresolvedClauses).toEqual([text]);
    });

    it("attaches deterministic_text evidence with the full source text", () => {
      const { rules } = extractEligibilityFromText("지원대상", "가구소득 기준중위소득 50% 이하인 가구");
      expect(rules[0].evidence).toEqual({
        sourceField: "지원대상",
        sourceText: "가구소득 기준중위소득 50% 이하인 가구",
        extractionType: "deterministic_text",
      });
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

    // -----------------------------------------------------------------
    // Province-spec residence binding (Checkpoint: MOIS region-clause
    // precision correction). Regression coverage for the fix to
    // findProvinceRegionSpecs/isBoundToResidenceSignal: a province mention
    // may become part of a residence region_in rule only when it is
    // positively bound (proximity window OR same "○"-delimited clause) to
    // an actual residence signal — NOT merely because a residence signal
    // exists somewhere else in the same text. See
    // docs/audits/mois-region-binding-precision.json for the frozen-catalog
    // audit and MOIS 351050000123 for the real confirmed false positive.
    // -----------------------------------------------------------------
    describe("province-spec residence binding (region-clause precision fix)", () => {
      it("A: a later ○-clause's employer/interview-location province mentions are NOT absorbed into the residence rule (real MOIS 351050000123 shape)", () => {
        const { rules } = extractEligibilityFromText(
          "f",
          "○ 인천광역시 미추홀구에 주민등록되어있는 18~39세 미취업 청년\r\n\r\n○ 서울, 경기, 인천 소재 기업 및 공공기관 취업면접 또는 서울, 인천지역 공무원 면접 응시자"
        );
        const regionRule = rules.find((r) => r.operator === "region_in");
        expect(regionRule).toEqual(
          expect.objectContaining({
            field: "residence",
            operator: "region_in",
            value: [{ province: "인천광역시", city: "미추홀구" }],
          })
        );
      });

      it("B: a compact OR list sharing one trailing residence word keeps all provinces as valid alternatives", () => {
        const { rules } = extractEligibilityFromText("f", "서울, 경기, 인천 거주자");
        expect(rules[0]).toEqual(
          expect.objectContaining({
            value: [{ province: "서울특별시" }, { province: "경기도" }, { province: "인천광역시" }],
          })
        );
      });

      it("C: a compact province+city OR list sharing one trailing residence word keeps both cities", () => {
        const { rules } = extractEligibilityFromText("f", "경기도 이천시, 여주시 거주자");
        expect(rules[0]).toEqual(
          expect.objectContaining({
            value: [
              { province: "경기도", city: "이천시" },
              { province: "경기도", city: "여주시" },
            ],
          })
        );
      });

      it("D: a province mention in its own ○-clause with no residence signal anywhere near it is not silently added, even though a residence signal exists in a separate ○-clause elsewhere in the text", () => {
        const { rules } = extractEligibilityFromText(
          "f",
          "○ 서울특별시 소재 협력업체 재직자 우대. ○ 신청자 본인의 주민등록상 거주지가 확인되는 자"
        );
        const regionRule = rules.find((r) => r.operator === "region_in");
        expect(regionRule).toBeUndefined();
      });

      it("E: lone-city (no province mention anywhere) proximity-window behavior is unchanged", () => {
        const { rules } = extractEligibilityFromText("f", "이천시 거주자만 신청 가능");
        expect(rules[0]).toEqual(expect.objectContaining({ value: [{ province: "경기도", city: "이천시" }] }));

        const result = extractEligibilityFromText(
          "f",
          "이천시에서 시행하는 사업으로, 접수는 온라인으로만 받으며 결과는 개별 통보합니다"
        );
        expect(result.rules).toEqual([]);
      });
    });

    // -----------------------------------------------------------------
    // Checkpoint: "Damoa MOIS Region Parser — Final Closeout Fix". Regression
    // coverage for the anaphora-recovery (Section 2) and false-positive-
    // exclusion (Sections 4-7) fixes made in this checkpoint, each traceable
    // to a specific real MOIS record surfaced by
    // docs/audits/mois-region-binding-manual-review.json /
    // docs/audits/mois-region-parser-closeout.json.
    // -----------------------------------------------------------------
    describe("final closeout fix (anaphora recovery + false-positive exclusions)", () => {
      it("A: a comma-joined OR-list of provinces, each annotated with its own bare (non-시/군/구-suffixed) district detail in parens, keeps every member once the first is bound to a residence signal (real MOIS 148000000035 shape)", () => {
        const { rules } = extractEligibilityFromText(
          "f",
          "서울특별시(송파, 강동, 광진), 경기도(남양주, 용인), 강원특별자치도(춘천, 원주), 충청북도(충주) 거주자만 신청 가능"
        );
        expect(rules[0]).toEqual(
          expect.objectContaining({
            value: [
              { province: "서울특별시" },
              { province: "경기도" },
              { province: "강원특별자치도" },
              { province: "충청북도" },
            ],
          })
        );
      });

      it("B: a bare district name inside a province's own trailing detail parens that happens to collide with an unrelated province alias (e.g. '광주') does not break the comma-joined list chain (real MOIS 148000000035 shape)", () => {
        const { rules } = extractEligibilityFromText(
          "f",
          "경기도(남양주, 용인, 이천, 하남, 여주, 광주, 가평, 양평), 강원특별자치도(춘천, 원주) 거주자만 신청 가능"
        );
        expect(rules[0]).toEqual(
          expect.objectContaining({ value: [{ province: "경기도" }, { province: "강원특별자치도" }] })
        );
      });

      it("C: a province mention inside a government-entity enumeration (funding/administering bodies, not applicant residence) is not treated as a residence condition (real MOIS O00026900002 shape)", () => {
        const result = extractEligibilityFromText(
          "f",
          "○ 사업시행자 : 국가, 인천광역시 및 인천광역시 남동구 ○ 신청일 기준 만 18세 이상인 자"
        );
        expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      });

      it("D: a province mention inside an event-organizer clause ('~가 주최·주관하는') is not treated as a residence condition (real MOIS O00007100023 shape)", () => {
        const result = extractEligibilityFromText("f", "국가ㆍ경기도 또는 시가 주최ㆍ주관하는 행사에 참가하는 선수");
        expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      });

      it("E: bare '경기' used in its 'match/game' sense (not Gyeonggi-do) is not guessed as a province mention when nothing after it confirms a place reading (real MOIS O00007100023 shape)", () => {
        const result = extractEligibilityFromText("f", "각종 경기에 시의 대표로 출전하는 선수 선발경기");
        expect(result.rules.find((r) => r.field === "residence")).toBeUndefined();
      });

      it("F: bare '경기' immediately followed by a compass sub-region word ('북부'/'남부'/'동부'/'서부') IS resolved as a genuine 경기도 residence mention, not excluded as ambiguous (real MOIS O00046700012 shape)", () => {
        const { rules } = extractEligibilityFromText("f", "경기북부권 지역 거주자");
        expect(rules[0]).toEqual(expect.objectContaining({ field: "residence", value: [{ province: "경기도" }] }));
      });

      it("G: Pattern A — a single province literally named elsewhere in the field is the safe referent of a deictic '도내 주민등록' back-reference", () => {
        const { rules } = extractEligibilityFromText(
          "지원대상",
          "전북특별자치도에 1년 이상 계속하여 보호자의 주민등록이 되어 있는 사람으로서 도내 주민등록이 되어 있는 자"
        );
        expect(rules[0]).toEqual(
          expect.objectContaining({ field: "residence", value: [{ province: "전북특별자치도" }] })
        );
      });

      it("H: Pattern B — an explicitly-named region SET spelled out across multiple staged enumeration clauses is recovered as a whole when a LATER, separate clause back-references it by its list label (real MOIS 135200005017 shape)", () => {
        const { rules } = extractEligibilityFromText(
          "지원대상",
          "○ (1단계 시범사업 대상지역) 서울 종로구, 경기 부천시('22.7~2024. 12. 31 종료) ○ (2단계 시범사업 대상지역) 경기 안양시, 대구 달서구('23.7~) ○ (기본 자격) 시범사업 지역 거주 취업자 또는 시범사업 지역 소재 사업장 근로자(거주지 무관), 만 15세 이상 대한민국 국적자"
        );
        const region = rules.find((r) => r.field === "residence");
        expect(region).toEqual(
          expect.objectContaining({
            field: "residence",
            value: [
              { province: "서울특별시", city: "종로구" },
              { province: "경기도", city: "부천시" },
              { province: "경기도", city: "안양시" },
              { province: "대구광역시", city: "달서구" },
            ],
          })
        );
      });

      it("I: a province mention inside an illustrative '(예시)' span is excluded from residence alternatives (real MOIS 401000000112 shape)", () => {
        const result = extractEligibilityFromText(
          "지원대상",
          "입학일 기준 시흥시에 주소를 둔 1학년 신입생 (예시) 서울시 소재 학교 학생 : 입학지원금 상한액 30만원"
        );
        const region = result.rules.find((r) => r.field === "residence");
        expect(region).toEqual(expect.objectContaining({ value: [{ province: "경기도", city: "시흥시" }] }));
      });

      it("J: a non-residence institution-location mention ('~ 소재 대학') is excluded even while a genuine same-field residence anaphora resolves correctly (real MOIS O00101000019 shape)", () => {
        const result = extractEligibilityFromText(
          "지원대상",
          "수도권(서울, 경기, 인천) 소재 대학, 산업대학 재학생으로서 전북특별자치도에 1년 이상 계속하여 보호자의 주민등록이 되어 있는 사람"
        );
        const region = result.rules.find((r) => r.field === "residence");
        expect(region).toEqual(expect.objectContaining({ value: [{ province: "전북특별자치도" }] }));
      });

      it("K: embedded province/brand-name tokens (SGI서울보증, 경남바로서비스) are not treated as residence mentions", () => {
        const withBrand = extractEligibilityFromText(
          "지원대상",
          "SGI서울보증에 가입한 자로서 신청일 기준 세종시에 주민등록이 되어 있는 자"
        );
        expect(withBrand.rules.find((r) => r.field === "residence")).toEqual(
          expect.objectContaining({ value: [{ province: "세종특별자치시" }] })
        );

        const noAnchor = extractEligibilityFromText(
          "지원대상",
          "도내 주민등록이 되어 있는 무주택 청년으로서 경남바로서비스 참조"
        );
        expect(noAnchor.rules.find((r) => r.field === "residence")).toBeUndefined();
      });
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

// ---------------------------------------------------------------------------
// Phase 2: marital/family eligibility — targeted synthetic regression tests
// (task 6 of the Phase 2 checkpoint-2 spec). These are AUTHORED sentences
// exercising specific parser behaviors in isolation, complementing (not
// duplicating) the real-MOIS-excerpt gold fixture in
// __tests__/fixtures/familyGoldSampleReal.ts / familyGoldSampleReal.test.ts.
// If a change to the family/marital parsers flips one of these, check
// whether it's an intentional improvement or a genuine regression.
// ---------------------------------------------------------------------------
describe("Phase 2: marital/family eligibility", () => {
  describe('"한부모 및 그 자녀" — family membership covers both parent and child', () => {
    it('"만 18세 미만 자녀를 둔 한부모 및 그 자녀를 지원합니다" -> singleParentFamily:true', () => {
      const result = extractEligibilityFromText("f", "만 18세 미만 자녀를 둔 한부모 및 그 자녀를 지원합니다");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "singleParentFamily", operator: "eq", value: true })
      );
    });
  });

  describe('"한부모가족의 자녀" — child-scoped membership, not "is a parent"', () => {
    it('"한부모가족의 자녀에게 학용품비를 지원한다" -> singleParentFamily:true', () => {
      const result = extractEligibilityFromText("f", "한부모가족의 자녀에게 학용품비를 지원한다");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "singleParentFamily", operator: "eq", value: true })
      );
    });
  });

  describe('"미혼모"', () => {
    it('"미혼모에게 출산용품을 지원한다" -> singleParentFamily:true', () => {
      const result = extractEligibilityFromText("f", "미혼모에게 출산용품을 지원한다");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "singleParentFamily", operator: "eq", value: true })
      );
    });
  });

  describe('"미혼부"', () => {
    it('"미혼부에게 양육비를 지원한다" -> singleParentFamily:true', () => {
      const result = extractEligibilityFromText("f", "미혼부에게 양육비를 지원한다");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "singleParentFamily", operator: "eq", value: true })
      );
    });
  });

  describe('ordinary phrase containing "한 부모" that is NOT the legal category', () => {
    it('"차량을 소지한 부모는 신청 대상에서 제외한다" -> no singleParentFamily rule (verb-ending "-한" + "부모", not the legal term)', () => {
      const result = extractEligibilityFromText("f", "차량을 소지한 부모는 신청 대상에서 제외한다");
      expect(result.rules.find((r) => r.field === "singleParentFamily")).toBeUndefined();
    });

    it('"본 사업은 한 부모 이상과 학생이 함께 거주해야 신청할 수 있다" -> no singleParentFamily rule ("이상" numeral idiom, not the legal term)', () => {
      const result = extractEligibilityFromText("f", "본 사업은 한 부모 이상과 학생이 함께 거주해야 신청할 수 있다");
      expect(result.rules.find((r) => r.field === "singleParentFamily")).toBeUndefined();
    });
  });

  describe("single-parent category inside an OR list of unrelated statuses", () => {
    it('"국민기초생활수급자 또는 차상위계층, 한부모가족 지원대상자 중 하나에 해당하는 자" -> no hard-AND singleParentFamily rule, reported unresolved instead', () => {
      const result = extractEligibilityFromText(
        "f",
        "국민기초생활수급자 또는 차상위계층, 한부모가족 지원대상자 중 하나에 해당하는 자"
      );
      expect(result.rules.find((r) => r.field === "singleParentFamily")).toBeUndefined();
      expect(result.unresolvedClauses.length).toBeGreaterThan(0);
    });
  });

  describe("다문화가족 child/member wording", () => {
    it('"다문화가족의 자녀는 우선 지원 대상이다" -> multiculturalFamily:true', () => {
      const result = extractEligibilityFromText("f", "다문화가족의 자녀는 우선 지원 대상이다");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "multiculturalFamily", operator: "eq", value: true })
      );
    });
  });

  describe("신혼부부 + explicit duration -> compound maritalStatus + marriage-duration rule", () => {
    it('"혼인신고일로부터 2년 이내인 신혼부부를 지원한다" -> maritalStatus:"married" AND marriageDate marriage_duration_within {years:2, boundary:"lte"}', () => {
      const result = extractEligibilityFromText("f", "혼인신고일로부터 2년 이내인 신혼부부를 지원한다");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "maritalStatus", operator: "eq", value: "married" })
      );
      expect(result.rules).toContainEqual(
        expect.objectContaining({
          field: "marriageDate",
          operator: "marriage_duration_within",
          value: { years: 2, boundary: "lte" },
        })
      );
    });
  });

  describe("예비신혼부부 — not yet married, must not assert maritalStatus:married", () => {
    it('"예비신혼부부도 신청할 수 있습니다" -> no marriageDate/maritalStatus rule, reported unresolved', () => {
      const result = extractEligibilityFromText("f", "예비신혼부부도 신청할 수 있습니다");
      expect(result.rules.find((r) => r.field === "marriageDate")).toBeUndefined();
      expect(result.rules.find((r) => r.field === "maritalStatus")).toBeUndefined();
      expect(result.unresolvedClauses.length).toBeGreaterThan(0);
    });
  });

  describe("bare 신혼부부 without any duration definition", () => {
    it('"신혼부부에게 전세자금을 지원한다" -> no marriageDate/maritalStatus rule (no threshold to extract), reported unresolved', () => {
      const result = extractEligibilityFromText("f", "신혼부부에게 전세자금을 지원한다");
      expect(result.rules.find((r) => r.field === "marriageDate")).toBeUndefined();
      expect(result.rules.find((r) => r.field === "maritalStatus")).toBeUndefined();
      expect(result.unresolvedClauses.length).toBeGreaterThan(0);
    });
  });

  describe("bare 다자녀 without an explicit number", () => {
    it('"다자녀 가구에게 우선순위를 부여한다" -> no childrenCount rule (no number to extract), reported unresolved', () => {
      const result = extractEligibilityFromText("f", "다자녀 가구에게 우선순위를 부여한다");
      expect(result.rules.find((r) => r.field === "childrenCount")).toBeUndefined();
      expect(result.unresolvedClauses.length).toBeGreaterThan(0);
    });
  });

  describe("자녀 2명 이상", () => {
    it('"자녀 2명 이상을 양육하는 가구" -> childrenCount gte 2', () => {
      const result = extractEligibilityFromText("f", "자녀 2명 이상을 양육하는 가구");
      expect(result.rules).toContainEqual(
        expect.objectContaining({ field: "childrenCount", operator: "gte", value: 2 })
      );
    });
  });

  // ---------------------------------------------------------------------
  // REGION — Checkpoint: Final Region Transition Compatibility.
  // resolveCitySpec's explicit-current-province fallback must keep city
  // specificity for "전남광주통합특별시 <city>" mentions, without touching the
  // bare-city (province-less) parsing path or its conservative ambiguity
  // handling at all.
  // ---------------------------------------------------------------------
  describe("전남광주통합특별시 explicit province+city parsing (city-specificity fix)", () => {
    it('"전남광주통합특별시 목포시" resolves to {province, city} instead of losing city specificity', () => {
      const result = extractEligibilityFromText("지원대상", "전남광주통합특별시 목포시에 거주하는 자");
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");
      expect(regionRule?.value).toEqual([{ province: "전남광주통합특별시", city: "목포시" }]);
    });

    it('"전남광주통합특별시 광산구" resolves to {province, city} instead of losing city specificity', () => {
      const result = extractEligibilityFromText("지원대상", "전남광주통합특별시 광산구에 거주하는 자");
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");
      expect(regionRule?.value).toEqual([{ province: "전남광주통합특별시", city: "광산구" }]);
    });

    it('a "전남광주통합특별시"-prefixed city NOT in the current roster still falls back to province-only (no guessing)', () => {
      const result = extractEligibilityFromText("지원대상", "전남광주통합특별시 없는시에 거주하는 자");
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");
      expect(regionRule?.value).toEqual([{ province: "전남광주통합특별시" }]);
    });

    it("bare '목포시' with no province prefix stays exactly as conservative as before (still resolves only to the historical province, never to the new merged name)", () => {
      const result = extractEligibilityFromText("지원대상", "목포시 관내 거주자");
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");
      expect(regionRule?.value).toEqual([{ province: "전라남도", city: "목포시" }]);
    });

    it("bare '광산구' with no province prefix does not become newly ambiguous or resolve to 전남광주통합특별시", () => {
      const result = extractEligibilityFromText("지원대상", "광산구 관내 거주자");
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");
      expect(regionRule?.value).toEqual([{ province: "광주광역시", city: "광산구" }]);
    });
  });
});
