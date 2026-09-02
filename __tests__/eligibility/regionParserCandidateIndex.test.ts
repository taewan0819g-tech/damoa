import { describe, expect, it } from "vitest";
import { buildCandidateIndex, getCandidateBenefits, getCandidateBenefitsFullScan } from "@/lib/eligibility/candidateIndex";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import type { Benefit } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Wires the improved region text-parser directly into a synthetic catalog
 * and sweeps the optimized candidate-index path against the full-scan
 * reference implementation, for the exact shapes the new gazetteer-backed
 * extraction now produces: a single gazetteer-resolved city, a multi-region
 * OR list (both province-list and same-province sibling-city-list forms),
 * and a province+city pair. This is the property the task calls out
 * explicitly: the optimized path must never remove a policy the full
 * deterministic rule engine would accept (no false-negative regression from
 * the region parser change), for any profile.
 */
function benefitFromRegionText(id: string, text: string): Benefit {
  const { rules } = extractEligibilityFromText("지원대상", text);
  return {
    id,
    title: id,
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
    eligibility: rules.length > 0 ? { type: "all", rules } : undefined,
  };
}

function catalog(): Benefit[] {
  return [
    benefitFromRegionText("gazetteer-lone-city", "이천시 거주자만 신청 가능"),
    benefitFromRegionText("gazetteer-lone-city-2", "강남구에 거주하는 자"),
    benefitFromRegionText("province-city", "경기도 성남시 거주자"),
    benefitFromRegionText("province-only", "서울 거주자만 신청 가능"),
    benefitFromRegionText("province-or-list", "서울특별시 또는 경기도 거주자만 신청 가능"),
    benefitFromRegionText("sibling-city-list", "경기도 이천시, 여주시 거주자만 신청 가능"),
    benefitFromRegionText("lone-city-list", "이천시, 여주시 거주자만 신청 가능"),
    benefitFromRegionText("collision-fix", "경기도 광주시 거주자만 신청 가능"),
    benefitFromRegionText("nationwide-no-rule", "전국 거주자 누구나 신청 가능"),
  ];
}

const RESIDENCE_PROFILES: UserProfile[] = [
  {},
  { residence: { province: "경기도", city: "이천시" } },
  { residence: { province: "경기도", city: "여주시" } },
  { residence: { province: "경기도", city: "수원시" } },
  { residence: { province: "경기도" } },
  { residence: { province: "서울특별시", city: "강남구" } },
  { residence: { province: "서울특별시" } },
  { residence: { province: "부산광역시" } },
  { residence: { province: "광주광역시" } },
];

describe("region-parser-produced eligibility vs candidate index — no false-negative regression", () => {
  it("indexed retrieval matches the full-scan reference for every real parser-produced region rule shape and profile", () => {
    const index = buildCandidateIndex(catalog());
    const mismatches: unknown[] = [];
    for (const profile of RESIDENCE_PROFILES) {
      const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
      const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
      if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) {
        mismatches.push({ profile, indexed, fullScan });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("a 경기도/이천시 resident is a candidate for every benefit whose region rule allows them, via the indexed path", () => {
    const index = buildCandidateIndex(catalog());
    const ids = getCandidateBenefits(index, { residence: { province: "경기도", city: "이천시" } }).map((b) => b.id).sort();
    // "collision-fix" ({경기도, city:광주시}) correctly excludes this 이천시 resident.
    expect(ids).toEqual(
      ["gazetteer-lone-city", "lone-city-list", "nationwide-no-rule", "province-or-list", "sibling-city-list"].sort()
    );
  });

  it("a 경기도/광주시 resident matches the collision-fix benefit but not the unrelated 이천시-only benefit", () => {
    const index = buildCandidateIndex(catalog());
    const ids = new Set(getCandidateBenefits(index, { residence: { province: "경기도", city: "광주시" } }).map((b) => b.id));
    expect(ids.has("collision-fix")).toBe(true);
    expect(ids.has("gazetteer-lone-city")).toBe(false);
  });

  it("nationwide text never produced a region rule at all, so it's a candidate for every profile including no residence info", () => {
    const index = buildCandidateIndex(catalog());
    const ids = getCandidateBenefits(index, {}).map((b) => b.id);
    expect(ids).toContain("nationwide-no-rule");
  });
});
