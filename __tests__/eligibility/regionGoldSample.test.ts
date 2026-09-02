import { describe, expect, it } from "vitest";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import { REGION_GOLD_SAMPLES } from "../fixtures/regionGoldSample";

/**
 * Runs the hand-reviewed gold sample (see fixtures/regionGoldSample.ts)
 * through the real, production `extractEligibilityFromText`. This is a
 * regression fixture, not a coverage test: if any of these flips, the
 * region extractor became either more aggressive (risk: false eligibility
 * exclusions) or more conservative (risk: silent coverage loss) than a
 * human reviewer signed off on — either direction deserves a manual look
 * before merging, which is exactly why this is a separate, explicit test
 * per sample rather than a generic loop assertion.
 */
describe("region gold sample regression fixture", () => {
  for (const sample of REGION_GOLD_SAMPLES) {
    it(`${sample.id}: ${sample.note}`, () => {
      const result = extractEligibilityFromText("지원대상", sample.text);
      const regionRule = result.rules.find((r) => r.field === "residence" && r.operator === "region_in");

      if (sample.expectation.outcome === "rule") {
        expect(regionRule, `expected a region rule for "${sample.text}"`).toBeDefined();
        expect(regionRule?.value).toEqual(sample.expectation.value);
      } else if (sample.expectation.outcome === "unresolved") {
        expect(regionRule, `did not expect a resolved rule for "${sample.text}"`).toBeUndefined();
        expect(result.unresolvedClauses.length, `expected an unresolved clause for "${sample.text}"`).toBeGreaterThan(0);
      } else {
        expect(regionRule, `did not expect a region rule for "${sample.text}"`).toBeUndefined();
        expect(result.unresolvedClauses, `did not expect an unresolved clause for "${sample.text}"`).toEqual([]);
      }
    });
  }

  it("covers every required stratification category from the task spec", () => {
    const ids = new Set(REGION_GOLD_SAMPLES.map((s) => s.id));
    const requiredPrefixes = [
      "province-only",
      "city-only",
      "province-and-city",
      "district-plus-metro",
      "alias-",
      "multi-region-",
      "nationwide-",
      "org-mention-",
      "ambiguous-",
      "hierarchy-",
    ];
    for (const prefix of requiredPrefixes) {
      const hasCategory = [...ids].some((id) => id.startsWith(prefix));
      expect(hasCategory, `missing gold-sample coverage for category "${prefix}"`).toBe(true);
    }
  });
});
