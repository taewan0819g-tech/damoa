import { describe, expect, it } from "vitest";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";
import { buildMaritalStatusRule } from "@/domain/youthCodebook/compatibility";
import { YOUTH_CODEBOOK_GOLD_SAMPLES_REAL } from "../fixtures/youthCodebookGoldSampleReal";

function rawPolicy(sourcePlcyNo: string, sourcePlcyNm: string, overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return { plcyNo: sourcePlcyNo, plcyNm: sourcePlcyNm, ...overrides };
}

describe("Youth codebook gold sample (real 온통청년 plcyNo records)", () => {
  it.each(YOUTH_CODEBOOK_GOLD_SAMPLES_REAL)("$id", (sample) => {
    const benefit = normalizeYouthPolicy(rawPolicy(sample.sourcePlcyNo, sample.sourcePlcyNm, sample.rawFields));

    if (sample.expectedRules.length === 0) {
      // A sample with zero expected rules must produce NO eligibility group
      // at all when its rawFields contain nothing else rule-worthy -- every
      // zero-rule sample in this fixture only sets the one field under test.
      expect(benefit.eligibility).toBeUndefined();
      return;
    }

    expect(benefit.eligibility?.type).toBe("all");
    expect(benefit.eligibility?.rules).toEqual(
      sample.expectedRules.map((r) => ({
        id: r.id,
        field: r.field,
        operator: r.operator,
        value: r.value,
        required: true,
        // Only the new status_compat rules (marital/employment/education)
        // carry evidence -- the pre-existing age/income rules never set it.
        // See the dedicated "carries structured_api evidence" test below for
        // the real evidence-shape assertion.
        ...(r.operator === "status_compat" ? { evidence: expect.any(Object) } : {}),
      }))
    );
  });

  it("covers every required gold-set category (§15)", () => {
    const ids = new Set(YOUTH_CODEBOOK_GOLD_SAMPLES_REAL.map((s) => s.id));
    const requiredIds = [
      // marital
      "real-marital-married-only",
      "real-marital-single-only",
      "real-marital-unrestricted-no-rule",
      "synthetic-marital-unknown-code-blocks-dimension",
      // employment
      "real-employment-employed-only",
      "real-employment-unemployed-only",
      "real-employment-self-employed-only-no-fail",
      "real-employment-or-two-supported-codes",
      "real-employment-or-with-unsupported-branch",
      "real-employment-freelancer-only-no-fail",
      // education
      "real-education-university-only",
      "real-education-graduate-only-no-fail",
      "real-education-unresolved-graduating-soon-no-rule",
      "real-education-or-unresolved-plus-resolved-neutralizes-fail",
      // combined
      "real-combined-marital-employment-income-one-record",
    ];
    for (const id of requiredIds) {
      expect(ids.has(id), `missing required gold-set category: ${id}`).toBe(true);
    }
    expect(YOUTH_CODEBOOK_GOLD_SAMPLES_REAL.length).toBeGreaterThanOrEqual(12);
  });

  it("resolves divorced and widowed to UNKNOWN against both 기혼 and 미혼 (Phase 4-B §6)", () => {
    const marriedRule = buildMaritalStatusRule("0055001");
    const singleRule = buildMaritalStatusRule("0055002");
    expect(marriedRule).toBeDefined();
    expect(singleRule).toBeDefined();

    const spec = marriedRule!.value as { passValues: string[]; failValues: string[] };
    expect(spec.passValues).not.toContain("divorced");
    expect(spec.passValues).not.toContain("widowed");
    expect(spec.failValues).not.toContain("divorced");
    expect(spec.failValues).not.toContain("widowed");

    const singleSpec = singleRule!.value as { passValues: string[]; failValues: string[] };
    expect(singleSpec.passValues).not.toContain("divorced");
    expect(singleSpec.passValues).not.toContain("widowed");
    expect(singleSpec.failValues).not.toContain("divorced");
    expect(singleSpec.failValues).not.toContain("widowed");
  });

  it("leaves the whole marital dimension unresolved when combined with an unknown code, even with a known code present (§3)", () => {
    const rule = buildMaritalStatusRule("0055001,0055099");
    expect(rule).toBeUndefined();
  });

  it("every rule built from a gold sample carries structured_api evidence pointing back to its raw source field", () => {
    for (const sample of YOUTH_CODEBOOK_GOLD_SAMPLES_REAL) {
      const benefit = normalizeYouthPolicy(
        rawPolicy(sample.sourcePlcyNo, sample.sourcePlcyNm, sample.rawFields)
      );
      for (const rule of benefit.eligibility?.rules ?? []) {
        if (!("id" in rule)) continue;
        if (rule.id === "youth-marital" || rule.id === "youth-employment" || rule.id === "youth-education") {
          expect(rule.evidence?.extractionType).toBe("structured_api");
          expect(typeof rule.evidence?.sourceField).toBe("string");
        }
      }
    }
  });
});
