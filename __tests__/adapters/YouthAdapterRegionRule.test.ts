import { describe, expect, it } from "vitest";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";
import { evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
import { YOUTH_ZIPCD_CROSSWALK } from "@/domain/youthCodebook/zipCdCrosswalk";
import type { EligibilityRule, EligibilityRuleGroup } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Checkpoint: Youth zipCd structured region eligibility.
 *
 * Adapter-level integration coverage for `YouthAdapter.ts`'s `buildEligibility()`
 * wiring of `domain/youthCodebook/compatibility.ts`'s `buildYouthRegionRule`
 * (itself backed by `domain/youthCodebook/zipCdCrosswalk.ts`'s
 * `resolveYouthZipCd`). The pure matching-engine semantics (subdivision
 * union completion, historical Incheon transitions, province aliasing) are
 * already covered by `__tests__/eligibility/region.test.ts` and
 * `__tests__/domain/region/subdivisionPartition.test.ts` — this file only
 * proves the FULL PIPELINE from a raw `zipCd` string on a `YouthRawPolicy`
 * through to a real eligibility verdict against a real `UserProfile`.
 */

function rawPolicy(overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return { plcyNo: "1", plcyNm: "Test Policy", ...overrides };
}

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

const ICHEON_ZIP = "41500"; // 경기도 이천시
const ASAN_ZIP = "44200"; // 충청남도 아산시
const HWASEONG_PARENT_ZIP = "41590"; // 경기도 화성시 (parent-aggregate)
const CHEONAN_PARENT_ZIP = "44130"; // 충청남도 천안시 (parent-aggregate)
const INCHEON_OLD_JUNGGU_ZIP = "28110"; // 인천광역시 중구 (historical, 폐지)
const SEJONG_ZIP = "36110"; // 세종특별자치시
const UNKNOWN_ZIP = "99999";

const icheonResident: UserProfile = { residence: { province: "경기도", city: "이천시" } };
const hwaseongResident: UserProfile = { residence: { province: "경기도", city: "화성시" } };
const cheonanResident: UserProfile = { residence: { province: "충청남도", city: "천안시" } };
const yeongjongguResident: UserProfile = { residence: { province: "인천광역시", city: "영종구" } };
const jemulpoguResident: UserProfile = { residence: { province: "인천광역시", city: "제물포구" } };
const suwonResident: UserProfile = { residence: { province: "경기도", city: "수원시" } };

const ALL_ZIP_TOKENS = Object.keys(YOUTH_ZIPCD_CROSSWALK).join(",");

describe("YouthAdapter region rule (checkpoint: Youth zipCd structured region eligibility)", () => {
  it("A) Icheon-coded policy + Icheon resident -> PASS", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: ICHEON_ZIP }));
    expect(leafRuleIds(benefit.eligibility).has("youth-region")).toBe(true);
    const diag = evaluateEligibilityDetailed(benefit, icheonResident);
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("B) Asan-only-coded policy + Icheon resident -> FAIL", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: ASAN_ZIP }));
    const diag = evaluateEligibilityDetailed(benefit, icheonResident);
    expect(diag.status).toBe("not_eligible");
    expect(diag.failedRules).toBeGreaterThan(0);
  });

  it("C) full nationwide zipCd roster + Icheon resident -> PASS", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: ALL_ZIP_TOKENS }));
    expect(benefit.hasUnresolvedEligibility).not.toBe(true);
    const diag = evaluateEligibilityDetailed(benefit, icheonResident);
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("H) explicit parent-aggregate 41590 (화성시 whole-city code) + 화성시 resident -> PASS", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: HWASEONG_PARENT_ZIP }));
    const diag = evaluateEligibilityDetailed(benefit, hwaseongResident);
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("I) explicit parent-aggregate 44130 (천안시 whole-city code) + 천안시 resident -> PASS", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: CHEONAN_PARENT_ZIP }));
    const diag = evaluateEligibilityDetailed(benefit, cheonanResident);
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("J) historical old-인천중구-coded policy + current 영종구 resident -> PASS (영종구 wholly within old 중구)", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: INCHEON_OLD_JUNGGU_ZIP }));
    const diag = evaluateEligibilityDetailed(benefit, yeongjongguResident);
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("K) historical old-인천중구-coded policy + current 제물포구 resident -> UNKNOWN, never FAIL (제물포구 only partially derived from old 중구)", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: INCHEON_OLD_JUNGGU_ZIP }));
    const diag = evaluateEligibilityDetailed(benefit, jemulpoguResident);
    expect(diag.status).not.toBe("not_eligible");
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBe(0);
  });

  it("L) unrecognized future zipCd token -> UNKNOWN-safe, no region rule built", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: UNKNOWN_ZIP }));
    expect(leafRuleIds(benefit.eligibility).has("youth-region")).toBe(false);
    expect(benefit.hasUnresolvedEligibility).toBe(true);
    const diag = evaluateEligibilityDetailed(benefit, icheonResident);
    expect(diag.status).toBe("unknown");
  });

  it("M) mixed known+unknown OR list must not manufacture a FAIL for anyone", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: `${ICHEON_ZIP},${UNKNOWN_ZIP}` }));
    expect(leafRuleIds(benefit.eligibility).has("youth-region")).toBe(false);
    expect(benefit.hasUnresolvedEligibility).toBe(true);
    // Even the Icheon resident who WOULD have matched the known branch must
    // not resolve to not_eligible -- the whole dimension is unresolved, so
    // no rule is built at all rather than a partial (falsely narrow) one.
    const diag = evaluateEligibilityDetailed(benefit, icheonResident);
    expect(diag.status).not.toBe("not_eligible");
  });

  it("N) region rule is derived ONLY from zipCd -- a misleading title/provider never contributes to or overrides it", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({
        zipCd: ICHEON_ZIP,
        plcyNm: "전국 대학생 취업 지원금 (전국 단위 사업)",
        sprvsnInstCdNm: "서울특별시청",
        operInstCdNm: "부산광역시 일자리센터",
      })
    );
    const regionRule = [...(benefit.eligibility?.rules ?? [])].find(
      (r): r is EligibilityRule => "id" in r && r.id === "youth-region"
    );
    expect(regionRule).toBeDefined();
    expect(regionRule?.value).toEqual([{ province: "경기도", city: "이천시" }]);

    const diag = evaluateEligibilityDetailed(benefit, icheonResident);
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("O) Sejong-only zipCd (36110) resolves to a province-only spec with no city", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: SEJONG_ZIP }));
    const regionRule = [...(benefit.eligibility?.rules ?? [])].find(
      (r): r is EligibilityRule => "id" in r && r.id === "youth-region"
    );
    expect(regionRule?.value).toEqual([{ province: "세종특별자치시" }]);

    const diag = evaluateEligibilityDetailed(benefit, { residence: { province: "세종특별자치시" } });
    expect(diag.failedRules).toBe(0);
    expect(diag.passedRules).toBeGreaterThan(0);
  });

  it("P) full nationwide zipCd roster still passes every kind of current resident, including a 13-parent-city resident via subdivision-union completion", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ zipCd: ALL_ZIP_TOKENS }));
    expect(benefit.hasUnresolvedEligibility).not.toBe(true);

    for (const resident of [icheonResident, hwaseongResident, cheonanResident, suwonResident]) {
      const diag = evaluateEligibilityDetailed(benefit, resident);
      expect(diag.failedRules).toBe(0);
      expect(diag.passedRules).toBeGreaterThan(0);
    }

    // Sejong has no subordinate city at all -- province-only match.
    const sejongDiag = evaluateEligibilityDetailed(benefit, { residence: { province: "세종특별자치시" } });
    expect(sejongDiag.failedRules).toBe(0);
    expect(sejongDiag.passedRules).toBeGreaterThan(0);
  });
});
