import { describe, expect, it } from "vitest";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import { MEDIAN_INCOME_GOLD_SAMPLES_REAL } from "../fixtures/medianIncomeGoldSampleReal";

/**
 * Runs the REAL-MOIS-text median-income gold sample (see
 * fixtures/medianIncomeGoldSampleReal.ts) through the real, production
 * `extractEligibilityFromText`. Complements the synthetic/authored median-
 * income tests in koreanEligibilityParser.test.ts with actual live-catalog
 * excerpts, each traceable back to its source MOIS 서비스ID and field.
 *
 * The parser only ever emits AT MOST ONE `median_income_threshold` rule per
 * text (it resolves the first percent+boundary occurrence only), so this
 * test asserts presence/absence of that single rule rather than comparing a
 * whole-set of rules like the family gold test does.
 */
describe("median income gold sample regression fixture (real MOIS excerpts)", () => {
  for (const sample of MEDIAN_INCOME_GOLD_SAMPLES_REAL) {
    it(`${sample.id} [${sample.sourceServiceId}/${sample.sourceField}]: ${sample.note.slice(0, 80)}...`, () => {
      const result = extractEligibilityFromText(sample.sourceField, sample.text);
      const medianIncomeRules = result.rules.filter((r) => r.operator === "median_income_threshold");

      if (sample.expectation.expectedRule) {
        expect(
          medianIncomeRules.length,
          `expected exactly 1 median_income_threshold rule for MOIS ${sample.sourceServiceId}, got ${medianIncomeRules.length}: ${JSON.stringify(medianIncomeRules)}`
        ).toBe(1);
        expect(medianIncomeRules[0]?.field).toBe("householdIncomeRange");
        expect(medianIncomeRules[0]?.value).toEqual(sample.expectation.expectedRule);
      } else {
        expect(
          medianIncomeRules.length,
          `expected NO median_income_threshold rule for MOIS ${sample.sourceServiceId}, got: ${JSON.stringify(medianIncomeRules)}`
        ).toBe(0);
      }

      if (sample.expectation.expectUnresolved) {
        expect(
          result.unresolvedClauses.length,
          `expected an unresolved clause for MOIS ${sample.sourceServiceId}, got rules: ${JSON.stringify(result.rules)}`
        ).toBeGreaterThan(0);
      }
    });
  }

  it("every entry has a traceable MOIS source (service ID + field)", () => {
    for (const sample of MEDIAN_INCOME_GOLD_SAMPLES_REAL) {
      expect(sample.sourceServiceId.length, `${sample.id} is missing a source service ID`).toBeGreaterThan(0);
      expect(["target", "criteria"]).toContain(sample.sourceField);
    }
  });

  it("covers every required regression category from the Phase 3 gold-set spec", () => {
    const ids = new Set(MEDIAN_INCOME_GOLD_SAMPLES_REAL.map((s) => s.id));
    const requiredPrefixes = [
      "real-rule-ordinary-profile-household-income", // ordinary household-income threshold, positive-signal-scoped
      "real-rule-bare-median-income-no-gijun-prefix", // bare 중위소득 coverage-gap fix + household-unit framing
      "real-rule-boundary-word-lt", // 미만
      "real-rule-boundary-word-gt", // 초과
      "real-unresolved-boundary-word-gte-no-corpus-example", // 이상 (checkpoint-5: zero real corpus hits w/ positive signal)
      "real-rule-explicit-year", // explicit year
      "real-rule-no-explicit-year", // no explicit year
      "real-unresolved-table-marker", // explicit per-size table marker
      "real-unresolved-table-truncated-by-window", // checkpoint-5: no positive signal, independent of table truncation
      "real-unresolved-genuine-fixed-reference-loan-program", // genuinely fixed-reference household size, still unresolved + fraction notation
      "real-unresolved-fixed-target-population-bare-median-income", // fixed-by-construction target population, still unresolved
      "real-unresolved-no-percent-digit", // no explicit percent digit
      "real-unresolved-sodeukinjeongaek-disqualifier", // 소득인정액
      "real-unresolved-health-insurance-premium-disqualifier", // 건강보험료/건보료
      "real-unresolved-jonghapsodeuk-and-fraction-disqualifier", // individual/applicant income (종합소득) + fraction notation
      "real-unresolved-individual-label-bonin", // individual/applicant income (본인 label)
      "real-unresolved-wage-income-disqualifier", // checkpoint-5: wage/earned income (임금/근로소득), incl. the 515000000168 correction
      "real-unresolved-couple-income-disqualifier", // checkpoint-5: couple-combined income (부부합산 소득)
      "real-unresolved-couple-income-combined-self-spouse-with-footnote", // checkpoint-5: 본인·배우자 합산, mechanism corrected
      "real-rule-status-category-wording-not-blocking", // category/status wording
      "real-unresolved-descriptive-mention-no-boundary", // descriptive/no-signal mention
      "real-rule-and-structure-cross-dimension", // AND structure (cross-dimension)
      "real-limitation-and-structure-within-median-income-only-first-captured", // AND structure (within median income itself)
      "real-rule-multiple-percentages-first-occurrence-wins", // multiple median-income percentages in one source
      "real-unresolved-percent-word-not-symbol", // 퍼센트 word form (unsupported)
    ];
    for (const prefix of requiredPrefixes) {
      const hasCategory = [...ids].some((id) => id.startsWith(prefix));
      expect(hasCategory, `missing real-MOIS gold-sample coverage for category "${prefix}"`).toBe(true);
    }
  });
});
