import { describe, expect, it } from "vitest";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import { FAMILY_GOLD_SAMPLES_REAL, type FamilyGoldField } from "../fixtures/familyGoldSampleReal";

/**
 * Runs the REAL-MOIS-text gold sample (see fixtures/familyGoldSampleReal.ts)
 * through the real, production `extractEligibilityFromText`. Complements any
 * authored/synthetic family tests with actual live-catalog excerpts, each
 * traceable back to its source MOIS 서비스ID and field. If any of these
 * flips, look at whether the change is an intentional improvement (see each
 * sample's `note` for entries already documenting a known limitation) or a
 * genuine regression.
 *
 * Unlike the single-field region gold test, family eligibility spans FIVE
 * distinct fields (singleParentFamily, multiculturalFamily, childrenCount,
 * marriageDate, maritalStatus), and a real newlywed clause legitimately
 * produces TWO rules at once (the maritalStatus + marriage-duration compound
 * rule). So this test compares the FULL SET of family-dimension rules
 * extracted against the FULL SET expected — not just presence of one rule —
 * to also catch unexpected extra rules, not only missing ones.
 */
const FAMILY_FIELDS: FamilyGoldField[] = [
  "singleParentFamily",
  "multiculturalFamily",
  "childrenCount",
  "marriageDate",
  "maritalStatus",
];

describe("family gold sample regression fixture (real MOIS excerpts)", () => {
  for (const sample of FAMILY_GOLD_SAMPLES_REAL) {
    it(`${sample.id} [${sample.sourceServiceId}/${sample.sourceField}]: ${sample.note.slice(0, 80)}...`, () => {
      const result = extractEligibilityFromText(sample.sourceField, sample.text);
      const familyRules = result.rules.filter((r) => FAMILY_FIELDS.includes(r.field as FamilyGoldField));

      expect(
        familyRules.length,
        `expected ${sample.expectation.expectedFamilyRules.length} family rule(s) for MOIS ${sample.sourceServiceId}, got ${familyRules.length}: ${JSON.stringify(familyRules)}`
      ).toBe(sample.expectation.expectedFamilyRules.length);

      for (const expected of sample.expectation.expectedFamilyRules) {
        const match = familyRules.find((r) => r.field === expected.field && r.operator === expected.operator);
        expect(
          match,
          `expected a ${expected.field}/${expected.operator} rule for MOIS ${sample.sourceServiceId}, got: ${JSON.stringify(familyRules)}`
        ).toBeDefined();
        expect(match?.value).toEqual(expected.value);
      }

      if (sample.expectation.expectUnresolved) {
        expect(
          result.unresolvedClauses.length,
          `expected an unresolved clause for MOIS ${sample.sourceServiceId}`
        ).toBeGreaterThan(0);
      }

      if (sample.expectation.expectNoRulesAtAll) {
        expect(
          result.rules.length,
          `expected ZERO rules of any kind for MOIS ${sample.sourceServiceId}, got: ${JSON.stringify(result.rules)}`
        ).toBe(0);
      }
    });
  }

  it("every entry has a traceable MOIS source (service ID + field)", () => {
    for (const sample of FAMILY_GOLD_SAMPLES_REAL) {
      expect(sample.sourceServiceId.length, `${sample.id} is missing a source service ID`).toBeGreaterThan(0);
      expect(["target", "criteria"]).toContain(sample.sourceField);
    }
  });

  it("covers every required task-6 regression category", () => {
    const ids = new Set(FAMILY_GOLD_SAMPLES_REAL.map((s) => s.id));
    const requiredPrefixes = [
      "real-rule-single-parent-clean", // 한부모 및 그 자녀
      "real-rule-single-parent-child-of-family", // 한부모가족의 자녀
      "real-rule-single-parent-mihonmo", // 미혼모
      "real-rule-single-parent-mihonbu", // 미혼부
      "real-no-rule-single-parent-verb-collision", // ordinary "한 부모" false positive
      "real-unresolved-sibling-status-category-or", // single-parent inside an OR list
      "real-rule-multicultural-family", // 다문화가족 child/member wording
      "real-rule-marriage-duration-1-year", // 신혼부부 + explicit duration
      "real-unresolved-newlywed-no-threshold", // 예비신혼부부
      "real-unresolved-newlywed-bare-current", // bare 신혼부부 without definition
      "real-unresolved-bare-multichild", // bare 다자녀
      "real-rule-children-threshold-2", // 자녀 2명 이상
    ];
    for (const prefix of requiredPrefixes) {
      const hasCategory = [...ids].some((id) => id.startsWith(prefix));
      expect(hasCategory, `missing real-MOIS gold-sample coverage for category "${prefix}"`).toBe(true);
    }
  });
});
