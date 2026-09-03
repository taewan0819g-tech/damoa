import { describe, expect, it } from "vitest";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";
import { buildCandidateIndex, getCandidateBenefits, getCandidateBenefitsFullScan } from "@/lib/eligibility/candidateIndex";
import type { UserProfile } from "@/types/profile";

/**
 * Phase 4-B §14/§16 integration check: proves the new Youth status_compat
 * rules (maritalStatus/employmentStatus/educationStatus, built by
 * domain/youthCodebook/compatibility.ts) integrate correctly with
 * `candidateIndex.ts` end-to-end using REAL `normalizeYouthPolicy` output
 * (not synthetic Benefit objects) -- `candidateIndex.test.ts` already proves
 * the generic status_compat indexing logic is correct in isolation; this
 * file proves the specific Youth-adapter wiring produces the exact same
 * indexed vs. full-scan result for real Youth records.
 */

function rawPolicy(plcyNo: string, overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return { plcyNo, plcyNm: `Youth Test ${plcyNo}`, ...overrides };
}

describe("Youth status_compat rules integrate correctly with candidateIndex", () => {
  const marriedOnly = normalizeYouthPolicy(rawPolicy("married-only", { mrgSttsCd: "0055001" }));
  const unemployedOnly = normalizeYouthPolicy(rawPolicy("unemployed-only", { jobCd: "0013003" }));
  const universityOnly = normalizeYouthPolicy(rawPolicy("university-only", { schoolCd: "0049005" }));
  const noRules = normalizeYouthPolicy(rawPolicy("no-rules", { mrgSttsCd: "0055003" }));
  const benefits = [marriedOnly, unemployedOnly, universityOnly, noRules];
  const index = buildCandidateIndex(benefits);

  it("puts a benefit with zero built rules (all-unrestricted codes) into unconstrained", () => {
    expect(index.unconstrained).toContainEqual(noRules);
  });

  it("prunes a 기혼-required Youth benefit for a definitively single profile", () => {
    const profile: UserProfile = { maritalStatus: "single" };
    const candidates = getCandidateBenefits(index, profile);
    expect(candidates).not.toContainEqual(marriedOnly);
    // full-scan must agree exactly (correctness parity, not just the fast path).
    expect(getCandidateBenefitsFullScan(index, profile)).not.toContainEqual(marriedOnly);
  });

  it("does NOT prune a 기혼-required Youth benefit when maritalStatus is unknown", () => {
    const profile: UserProfile = {};
    const candidates = getCandidateBenefits(index, profile);
    expect(candidates).toContainEqual(marriedOnly);
  });

  it("does NOT prune a 기혼-required Youth benefit for divorced/widowed profiles (must resolve UNKNOWN, not FAIL, per §6)", () => {
    for (const maritalStatus of ["divorced", "widowed"] as const) {
      const profile: UserProfile = { maritalStatus };
      expect(getCandidateBenefits(index, profile)).toContainEqual(marriedOnly);
      expect(getCandidateBenefitsFullScan(index, profile)).toContainEqual(marriedOnly);
    }
  });

  it("prunes a 미취업자-required Youth benefit for an employed or self-employed profile, keeps it for unemployed", () => {
    for (const employmentStatus of ["employed", "self_employed"] as const) {
      const profile: UserProfile = { employmentStatus };
      expect(getCandidateBenefits(index, profile)).not.toContainEqual(unemployedOnly);
      expect(getCandidateBenefitsFullScan(index, profile)).not.toContainEqual(unemployedOnly);
    }
    const passingProfile: UserProfile = { employmentStatus: "unemployed" };
    expect(getCandidateBenefits(index, passingProfile)).toContainEqual(unemployedOnly);
  });

  it("prunes a 대학 재학-required Youth benefit for a graduate_school profile, keeps it for university", () => {
    const failProfile: UserProfile = { educationStatus: "graduate_school" };
    expect(getCandidateBenefits(index, failProfile)).not.toContainEqual(universityOnly);
    expect(getCandidateBenefitsFullScan(index, failProfile)).not.toContainEqual(universityOnly);

    const passProfile: UserProfile = { educationStatus: "university" };
    expect(getCandidateBenefits(index, passProfile)).toContainEqual(universityOnly);
  });

  it("indexed and full-scan results agree exactly across a spread of profiles (mismatchCount = 0)", () => {
    const profiles: UserProfile[] = [
      {},
      { maritalStatus: "single" },
      { maritalStatus: "married" },
      { maritalStatus: "divorced" },
      { maritalStatus: "widowed" },
      { employmentStatus: "employed" },
      { employmentStatus: "unemployed" },
      { employmentStatus: "self_employed" },
      { employmentStatus: "freelancer" },
      { educationStatus: "university" },
      { educationStatus: "graduate_school" },
      { educationStatus: "graduated" },
      { maritalStatus: "single", employmentStatus: "unemployed", educationStatus: "university" },
      { maritalStatus: "married", employmentStatus: "employed", educationStatus: "graduate_school" },
    ];
    let mismatchCount = 0;
    for (const profile of profiles) {
      const optimized = new Set(getCandidateBenefits(index, profile));
      const full = new Set(getCandidateBenefitsFullScan(index, profile));
      if (optimized.size !== full.size || [...optimized].some((b) => !full.has(b))) mismatchCount++;
    }
    expect(mismatchCount).toBe(0);
  });
});
