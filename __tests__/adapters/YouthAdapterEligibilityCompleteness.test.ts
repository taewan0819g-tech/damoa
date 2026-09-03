import { describe, expect, it } from "vitest";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";
import { evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
import type { UserProfile } from "@/types/profile";

/**
 * Regression coverage for Phase 4-B §13: adding the new marital/employment/
 * education status_compat rules to Youth records must NEVER, by itself,
 * cause a benefit to resolve "likely_eligible" — a full pass on Youth data
 * is still only a pass on a KNOWN-incomplete rule set (Youth Center records
 * always carry real sbizCd/zipCd/plcyMajorCd eligibility data we still don't
 * structure; see YouthAdapter.ts's `eligibilityDataStatus` doc comment). The
 * only way a Youth eligibility check should ever surface as "not_eligible"
 * is a genuine, concretely-proven FAIL against parsed data — a pass, or an
 * already-unknown result, must stay "unknown".
 */

function rawPolicy(overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return { plcyNo: "1", plcyNm: "Test Policy", ...overrides };
}

describe("Youth eligibilityDataStatus stays conservative (Phase 4-B §13)", () => {
  it("a benefit with ALL new rules genuinely passing still resolves 'unknown', not 'likely_eligible'", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({
        mrgSttsCd: "0055002", // 미혼 (single-required)
        jobCd: "0013001", // 재직자 (employed-required)
        schoolCd: "0049005", // 대학 재학 (university-required)
      })
    );
    expect(benefit.eligibilityDataStatus).toBe("incomplete");

    const profile: UserProfile = {
      maritalStatus: "single",
      employmentStatus: "employed",
      educationStatus: "university",
    };

    const diagnostics = evaluateEligibilityDetailed(benefit, profile);
    expect(diagnostics.passedRules).toBe(3);
    expect(diagnostics.failedRules).toBe(0);
    // A full pass on "incomplete" data must be DOWNGRADED, never promoted.
    expect(diagnostics.status).toBe("unknown");
    expect(diagnostics.downgradedFromPass).toBe(true);
  });

  it("a benefit with a genuine FAIL still resolves 'not_eligible' even though the data is incomplete", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ mrgSttsCd: "0055001" })); // 기혼 (married-required)
    expect(benefit.eligibilityDataStatus).toBe("incomplete");

    const profile: UserProfile = { maritalStatus: "single" };
    const diagnostics = evaluateEligibilityDetailed(benefit, profile);
    expect(diagnostics.status).toBe("not_eligible");
    expect(diagnostics.downgradedFromPass).toBe(false);
  });

  it("a benefit whose only built dimensions are unrestricted/unresolved has NO eligibility group and resolves 'unknown', never 'likely_eligible'", () => {
    // Every code below is either the family's own 제한없음 or a code with no
    // safe compat mapping (0013006 = (예비)창업자, entirely unresolved) --
    // buildEligibility must return undefined, and eligibilityDataStatus must
    // be undefined too (never "unrestricted"), so a real user profile that
    // would trivially pass everything still can't reach "likely_eligible".
    const benefit = normalizeYouthPolicy(
      rawPolicy({
        mrgSttsCd: "0055003", // 제한없음
        jobCd: "0013006", // unresolved
        schoolCd: "0049010", // 제한없음
        earnCndSeCd: "0043001", // 무관 (no income condition)
        sprtTrgtAgeLmtYn: "N",
      })
    );
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.eligibilityDataStatus).toBeUndefined();
    expect(benefit.eligibilityUnrestricted).toBeUndefined();

    const diagnostics = evaluateEligibilityDetailed(benefit, {});
    expect(diagnostics.status).toBe("unknown");
    expect(diagnostics.totalRules).toBe(0);
  });

  it("a genuinely unresolved (unknown-value) rule set still stays 'unknown', not promoted", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ mrgSttsCd: "0055001" })); // 기혼-required
    const profile: UserProfile = {}; // maritalStatus not set -> unresolved field
    const diagnostics = evaluateEligibilityDetailed(benefit, profile);
    expect(diagnostics.status).toBe("unknown");
    expect(diagnostics.downgradedFromPass).toBe(false);
    expect(diagnostics.hasEvidence).toBe(false);
  });
});
