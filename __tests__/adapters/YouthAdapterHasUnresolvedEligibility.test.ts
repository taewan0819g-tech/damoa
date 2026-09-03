import { describe, expect, it } from "vitest";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";
import { evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
import type { EligibilityRule, EligibilityRuleGroup } from "@/types/benefit";

/**
 * Regression coverage for Phase 4-B pre-merge cleanup §8: locks in the 10
 * explicitly-specified `hasUnresolvedEligibility` scenarios. Two themes run
 * through every case:
 *   (a) a family's own 제한없음(unrestricted) code must NEVER by itself set
 *       `hasUnresolvedEligibility` (§2) -- distinct from genuinely unresolved
 *       data;
 *   (b) a dimension can simultaneously contribute POSITIVE structured
 *       evidence (a real, useful rule) AND flag `hasUnresolvedEligibility`
 *       when a multi-code value mixes a safe branch with an unresolved one
 *       (§1) -- one must never be discarded in favor of the other.
 */

function rawPolicy(overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return { plcyNo: "1", plcyNm: "Test Policy", ...overrides };
}

/** Flattens a benefit's eligibility rule tree to its leaf rule ids (Youth records are always flat, but guard the union type anyway). */
function leafRuleIds(group: EligibilityRuleGroup | undefined): Set<string> {
  const ids = new Set<string>();
  if (!group) return ids;
  const visit = (node: EligibilityRuleGroup | EligibilityRule) => {
    if ("id" in node) {
      ids.add(node.id);
    } else {
      for (const child of node.rules) visit(child);
    }
  };
  for (const rule of group.rules) visit(rule);
  return ids;
}

describe("Youth hasUnresolvedEligibility (Phase 4-B pre-merge cleanup, §8)", () => {
  it("1) mrgSttsCd=제한없음 (0055003) does not set hasUnresolvedEligibility from the marital dimension", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ mrgSttsCd: "0055003" }));
    expect(benefit.hasUnresolvedEligibility).not.toBe(true);
    expect(leafRuleIds(benefit.eligibility).has("youth-marital")).toBe(false);
  });

  it("2) jobCd=재직자,예비창업자 (0013001,0013006) still builds a useful employment rule AND sets hasUnresolvedEligibility=true", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ jobCd: "0013001,0013006" }));
    expect(leafRuleIds(benefit.eligibility).has("youth-employment")).toBe(true);
    expect(benefit.hasUnresolvedEligibility).toBe(true);

    // Lock in the exact PASS/UNKNOWN-not-FAIL semantics this combo requires
    // (§6/§8): employed -> PASS, unemployed -> UNKNOWN (never FAIL), because
    // 0013006 remains a possible unresolved OR-branch.
    const employedDiag = evaluateEligibilityDetailed(benefit, { employmentStatus: "employed" });
    expect(employedDiag.failedRules).toBe(0);
    expect(employedDiag.passedRules).toBe(1);

    const unemployedDiag = evaluateEligibilityDetailed(benefit, { employmentStatus: "unemployed" });
    expect(unemployedDiag.status).not.toBe("not_eligible");
  });

  it("3) jobCd=예비창업자 only (0013006) builds no employment rule AND sets hasUnresolvedEligibility=true", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ jobCd: "0013006" }));
    expect(leafRuleIds(benefit.eligibility).has("youth-employment")).toBe(false);
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("4) schoolCd=대졸 예정 (0049006) builds no education rule AND sets hasUnresolvedEligibility=true", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ schoolCd: "0049006" }));
    expect(leafRuleIds(benefit.eligibility).has("youth-education")).toBe(false);
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("5) sbizCd=제한없음 (0014010) does not set hasUnresolvedEligibility from the sbiz dimension", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ sbizCd: "0014010" }));
    expect(benefit.hasUnresolvedEligibility).not.toBe(true);
  });

  it("6) sbizCd=한부모가정 (0014004) sets hasUnresolvedEligibility=true even though sbizCd is never wired into a rule", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ sbizCd: "0014004" }));
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("7) plcyMajorCd=제한없음 (0011009) does not set hasUnresolvedEligibility from the major dimension", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ plcyMajorCd: "0011009" }));
    expect(benefit.hasUnresolvedEligibility).not.toBe(true);
  });

  it("8) plcyMajorCd=공학계열 (0011005) sets hasUnresolvedEligibility=true even though plcyMajorCd is never wired into a rule", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ plcyMajorCd: "0011005" }));
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("9) a populated zipCd remains unresolved this phase -- flags hasUnresolvedEligibility and never contributes a rule", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: "11680" }));
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(true);
  });

  it("10) eligibility undefined + an unsupported specific code still resolves 'unknown', never promoted", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ jobCd: "0013006" })); // (예비)창업자, unresolved
    expect(benefit.eligibility).toBeUndefined();
    expect(benefit.hasUnresolvedEligibility).toBe(true);
    expect(benefit.eligibilityUnrestricted).toBeUndefined();

    const diagnostics = evaluateEligibilityDetailed(benefit, {});
    expect(diagnostics.status).toBe("unknown");
    expect(diagnostics.totalRules).toBe(0);
  });
});
