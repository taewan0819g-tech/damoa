import { describe, expect, it } from "vitest";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import { REGION_GOLD_SAMPLES_REAL } from "../fixtures/regionGoldSampleReal";

/**
 * Runs the REAL-MOIS-text gold sample (see fixtures/regionGoldSampleReal.ts)
 * through the real, production `extractEligibilityFromText`. Complements
 * `regionGoldSample.test.ts` (authored representative sentences) with actual
 * live-catalog excerpts, each traceable back to its source MOIS 서비스ID and
 * field. If any of these flips, look at whether the change is an intentional
 * improvement (see each sample's `note` for entries already documenting a
 * known limitation) or a genuine regression.
 */
describe("region gold sample regression fixture (real MOIS excerpts)", () => {
  for (const sample of REGION_GOLD_SAMPLES_REAL) {
    it(`${sample.id} [${sample.sourceServiceId}/${sample.sourceField}]: ${sample.note.slice(0, 80)}...`, () => {
      const result = extractEligibilityFromText(sample.sourceField, sample.text);
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");

      if (sample.expectation.outcome === "rule") {
        expect(regionRule, `expected a region rule for MOIS ${sample.sourceServiceId}`).toBeDefined();
        expect(regionRule?.value).toEqual(sample.expectation.value);
      } else if (sample.expectation.outcome === "unresolved") {
        expect(regionRule, `did not expect a resolved rule for MOIS ${sample.sourceServiceId}`).toBeUndefined();
        expect(
          result.unresolvedClauses.length,
          `expected an unresolved clause for MOIS ${sample.sourceServiceId}`
        ).toBeGreaterThan(0);
      } else {
        expect(regionRule, `did not expect a region rule for MOIS ${sample.sourceServiceId}`).toBeUndefined();
      }
    });
  }

  it("every entry has a traceable MOIS source (service ID + field)", () => {
    for (const sample of REGION_GOLD_SAMPLES_REAL) {
      expect(sample.sourceServiceId.length, `${sample.id} is missing a source service ID`).toBeGreaterThan(0);
      expect(["target", "criteria"]).toContain(sample.sourceField);
    }
  });

  it("covers every required stratification category from the task spec", () => {
    const ids = new Set(REGION_GOLD_SAMPLES_REAL.map((s) => s.id));
    const requiredPrefixes = [
      "real-rule-lone-city",
      "real-rule-short-district",
      "real-rule-province-and-city",
      "real-rule-multi-region",
      "real-no-rule-",
      "real-unresolved-ambiguous",
      "real-unresolved-bare-short-district",
    ];
    for (const prefix of requiredPrefixes) {
      const hasCategory = [...ids].some((id) => id.startsWith(prefix));
      expect(hasCategory, `missing real-MOIS gold-sample coverage for category "${prefix}"`).toBe(true);
    }
  });
});
