import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasUnresolvedLocalScopeConflict, resolveOrganizationRegion } from "@/domain/benefit/localScope";
import { getRecommendedBenefits, countRecommendableBenefits } from "@/domain/benefit/recommend";
import { getUnknownBenefits } from "@/domain/benefit/unknownBenefits";
import { sortBenefits } from "@/domain/benefit/sort";
import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Home precision-gate regression tests, modeled on the real Icheon
 * (경기도/이천시) beta bug: MOIS records with no resolvable region rule (status
 * stays "unknown") were still surfacing in Home's bounded `recommended`
 * preview even when their publishing organization is structurally local to a
 * different province/city. See `domain/benefit/localScope.ts`.
 */
const profile: UserProfile = {
  residence: { province: "경기도", city: "이천시" },
  individualIncomeBand: "under_1000",
};

const incomeRule = {
  id: "income",
  field: "individualIncomeRange",
  operator: "range_within" as const,
  // Raw KRW — must fully contain the resolved under_1000 band so the leaf
  // actually PASSES, giving each fixture "moderate" (not "weak") strength.
  value: [0, 20_000_000],
  required: true,
};

function makeBenefit(overrides: Partial<Benefit> & Pick<Benefit, "id" | "source">): Benefit {
  return {
    title: "t",
    shortDescription: "d",
    category: "welfare",
    benefitType: "other",
    eligibility: { type: "all", rules: [incomeRule] },
    ...overrides,
  };
}

const gyeonggiWide = makeBenefit({
  id: "gyeonggi-wide",
  source: { type: "government", organization: "경기도" },
  institution: { name: "경기도", type: "local_government" },
  eligibility: {
    type: "all",
    rules: [
      incomeRule,
      { id: "region", field: "residence", operator: "region_in", value: [{ province: "경기도" }], required: true },
    ],
  },
});

const nationwide = makeBenefit({
  id: "nationwide",
  source: { type: "government", organization: "국토교통부" },
  institution: { name: "국토교통부", type: "government" },
});

const anotherCityUnresolved = makeBenefit({
  id: "another-city-unresolved",
  source: { type: "government", organization: "경기도 평택시" },
  institution: { name: "경기도 평택시", type: "local_government" },
});

const anotherProvinceUnresolved = makeBenefit({
  id: "another-province-unresolved",
  source: { type: "government", organization: "경상남도" },
  institution: { name: "경상남도", type: "local_government" },
});

const benefits = [gyeonggiWide, nationwide, anotherCityUnresolved, anotherProvinceUnresolved];
const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));

describe("hasUnresolvedLocalScopeConflict — resolveOrganizationRegion", () => {
  it("resolves a bare province token", () => {
    expect(resolveOrganizationRegion("경상남도")).toEqual({ province: "경상남도" });
  });

  it("resolves province + recognized city token", () => {
    expect(resolveOrganizationRegion("경기도 평택시")).toEqual({ province: "경기도", city: "평택시" });
  });

  it("returns undefined for a central-ministry name with no province token", () => {
    expect(resolveOrganizationRegion("국토교통부")).toBeUndefined();
  });
});

describe("Home precision gate — getRecommendedBenefits(excludeWeakUnknown: true)", () => {
  const home = getRecommendedBenefits(benefits, statusById, profile, benefits.length, { excludeWeakUnknown: true });
  const homeIds = home.map((b) => b.id);

  it("1. keeps a Gyeonggi-wide compatible policy Home-recommendable", () => {
    expect(homeIds).toContain("gyeonggi-wide");
  });

  it("2. keeps a nationwide (central-ministry) policy Home-recommendable", () => {
    expect(homeIds).toContain("nationwide");
  });

  it("3. excludes an another-city policy with unresolved/broader region evidence", () => {
    expect(homeIds).not.toContain("another-city-unresolved");
  });

  it("4. excludes an another-province local-scope-unresolved policy", () => {
    expect(homeIds).not.toContain("another-province-unresolved");
  });

  it("5. never marks a demoted item not_eligible — status map is untouched by the gate", () => {
    expect(statusById.get("another-city-unresolved")).toBe("unknown");
    expect(statusById.get("another-province-unresolved")).toBe("unknown");
  });

  it("6. demoted items remain available via needsReview (and full browse)", () => {
    const excludeIds = new Set(homeIds);
    const needsReview = getUnknownBenefits(benefits, statusById, profile, benefits.length, { excludeIds });
    const needsReviewIds = needsReview.map((b) => b.id);
    expect(needsReviewIds).toContain("another-city-unresolved");
    expect(needsReviewIds).toContain("another-province-unresolved");
  });

  it("8. UNKNOWN is never described as confirmed eligibility — admitted items keep 'unknown' status", () => {
    for (const id of homeIds) {
      expect(statusById.get(id)).toBe("unknown");
    }
  });

  it("9. full /benefits matching (sortBenefits='recommended') is unaffected — keeps every benefit, no gate applied", () => {
    const sorted = sortBenefits(benefits, statusById, profile, "recommended");
    expect(sorted.map((b) => b.id).sort()).toEqual(
      ["another-city-unresolved", "another-province-unresolved", "gyeonggi-wide", "nationwide"].sort()
    );
  });

  it("countRecommendableBenefits agrees with getRecommendedBenefits admission over the full set", () => {
    expect(countRecommendableBenefits(benefits, statusById, profile)).toBe(2);
  });
});

describe("7. Home summary no longer renders the misleading '받을 가능성이 있는 혜택 0개' metric", () => {
  const summaryCardsSrc = readFileSync(join(process.cwd(), "components/home/SummaryCards.tsx"), "utf-8");
  const homePageSrc = readFileSync(join(process.cwd(), "app/(app)/home/page.tsx"), "utf-8");

  it("SummaryCards no longer references the old misleading label or field", () => {
    expect(summaryCardsSrc).not.toContain("받을 가능성이 있는 혜택");
    expect(summaryCardsSrc).not.toContain("likelyEligibleCount");
    expect(summaryCardsSrc).toContain("summary.priorityCount");
    expect(summaryCardsSrc).toContain("우선 확인할 혜택");
  });

  it("Home page section heading is no longer the bare '다모아 추천' label", () => {
    expect(homePageSrc).not.toContain("다모아 추천");
    expect(homePageSrc).toContain("우선 확인해볼 혜택");
  });
});

describe("hasUnresolvedLocalScopeConflict — direct unit behavior", () => {
  it("never flags an exact_city-verified benefit regardless of organization", () => {
    expect(hasUnresolvedLocalScopeConflict(anotherProvinceUnresolved, profile, "exact_city")).toBe(false);
  });

  it("never flags a benefit whose institution isn't local_government", () => {
    expect(hasUnresolvedLocalScopeConflict(nationwide, profile, "none")).toBe(false);
  });

  it("never flags a local_government org with no recognizable province token", () => {
    const benefit = makeBenefit({
      id: "unrecognized-org",
      source: { type: "government", organization: "다모아재단" },
      institution: { name: "다모아재단", type: "local_government" },
    });
    expect(hasUnresolvedLocalScopeConflict(benefit, profile, "none")).toBe(false);
  });
});
