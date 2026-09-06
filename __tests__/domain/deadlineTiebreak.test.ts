import { describe, expect, it } from "vitest";
import { getRecommendedBenefits } from "@/domain/benefit/recommend";
import { getUnknownBenefits } from "@/domain/benefit/unknownBenefits";
import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Regression coverage for the D-day NaN tiebreak bug (see
 * __tests__/lib/dday.test.ts for the isolated comparator coverage). This
 * file proves the bug's actual, user-visible consequence: two candidates
 * that tie on every ranking key EXCEPT id, and both lack a resolvable
 * upcoming deadline (`date_unknown` — the overwhelmingly common case in the
 * real catalog), must sort by benefit id exactly as documented — NOT by
 * whatever order they happened to occupy in the pre-sort array.
 */
const profile: UserProfile = {
  residence: { province: "경기도", city: "이천시" },
  individualIncomeBand: "under_1000",
  interests: ["employment"],
};

function makeBenefit(overrides: Partial<Benefit> & Pick<Benefit, "id" | "source">): Benefit {
  return {
    title: "t",
    shortDescription: "d",
    category: "employment",
    benefitType: "other",
    topics: ["employment"],
    eligibility: { type: "all", rules: [] },
    ...overrides,
  };
}

describe("getRecommendedBenefits: date_unknown vs date_unknown ties fall through to id, not array order", () => {
  it("sorts two otherwise-identical date_unknown candidates by id regardless of input array order", () => {
    // Deliberately placed with the LEXICALLY LARGER id first in the input
    // array. Before the fix, Infinity-Infinity produced NaN and the
    // comparator silently preserved this (wrong) input order.
    const zBenefit = makeBenefit({ id: "youth-z-no-date", source: { type: "youth_policy", organization: "o" } });
    const aBenefit = makeBenefit({ id: "youth-a-no-date", source: { type: "youth_policy", organization: "o" } });
    const benefits = [zBenefit, aBenefit];
    const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));

    const result = getRecommendedBenefits(benefits, statusById, profile, benefits.length);
    expect(result.map((b) => b.id)).toEqual(["youth-a-no-date", "youth-z-no-date"]);
  });

  it("a finite deadline still outranks a date_unknown candidate even when tied on every earlier key", () => {
    const noDate = makeBenefit({ id: "no-date", source: { type: "youth_policy", organization: "o" } });
    const hasDate = makeBenefit({
      id: "has-date",
      source: { type: "youth_policy", organization: "o" },
      application: { startDate: "2026-01-01", endDate: "2099-01-01" },
    });
    const benefits = [noDate, hasDate];
    const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));

    const result = getRecommendedBenefits(benefits, statusById, profile, benefits.length);
    expect(result.map((b) => b.id)).toEqual(["has-date", "no-date"]);
  });

  it("a TODAY (D-0) deadline still outranks a date_unknown candidate even when tied on every earlier key", () => {
    // Regression coverage for the second deadline-comparator bug: before the
    // resolveComparableDays fix, a "today" deadline fell into the same
    // "unknown" bucket as no-date at all, so this ordering would incorrectly
    // tie (and fall through to the id tiebreak, which happens to sort
    // "no-date" first here — the wrong, buggy order this test guards against).
    const todayIso = new Date().toISOString().slice(0, 10);
    const noDate = makeBenefit({ id: "no-date", source: { type: "youth_policy", organization: "o" } });
    const dueToday = makeBenefit({
      id: "due-today",
      source: { type: "youth_policy", organization: "o" },
      application: { startDate: "2020-01-01", endDate: todayIso },
    });
    const benefits = [noDate, dueToday];
    const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));

    const result = getRecommendedBenefits(benefits, statusById, profile, benefits.length);
    expect(result.map((b) => b.id)).toEqual(["due-today", "no-date"]);
  });

  it("never throws/produces undefined ordering (no NaN leaking into .sort) across many date_unknown ties", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeBenefit({ id: `youth-${String(i).padStart(2, "0")}`, source: { type: "youth_policy", organization: "o" } })
    ).reverse(); // reverse id order on purpose
    const statusById = new Map<string, EligibilityStatus>(many.map((b) => [b.id, "unknown"]));
    const result = getRecommendedBenefits(many, statusById, profile, many.length);
    expect(result.map((b) => b.id)).toEqual(many.map((b) => b.id).slice().sort((a, b) => a.localeCompare(b)));
  });
});

describe("getUnknownBenefits: date_unknown vs date_unknown ties fall through to id, not array order", () => {
  it("sorts two otherwise-identical date_unknown candidates by id regardless of input array order", () => {
    const zBenefit = makeBenefit({ id: "mois-z-no-date", source: { type: "government", organization: "o" } });
    const aBenefit = makeBenefit({ id: "mois-a-no-date", source: { type: "government", organization: "o" } });
    const benefits = [zBenefit, aBenefit];
    const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));

    const result = getUnknownBenefits(benefits, statusById, profile, benefits.length);
    expect(result.map((b) => b.id)).toEqual(["mois-a-no-date", "mois-z-no-date"]);
  });
});

describe("getUnknownBenefits: excludeLocalScopeConflicts (Home needsReview preview-only gate)", () => {
  const incomeRule = {
    id: "income",
    field: "individualIncomeRange" as const,
    operator: "range_within" as const,
    value: [0, 20_000_000],
    required: true,
  };

  const conflictingLocal = makeBenefit({
    id: "conflicting-local",
    source: { type: "government", organization: "경상남도" },
    institution: { name: "경상남도", type: "local_government" },
    eligibility: { type: "all", rules: [incomeRule] },
  });
  const compatibleNational = makeBenefit({
    id: "compatible-national",
    source: { type: "government", organization: "국토교통부" },
    institution: { name: "국토교통부", type: "government" },
    eligibility: { type: "all", rules: [incomeRule] },
  });
  const compatibleGyeonggi = makeBenefit({
    id: "compatible-gyeonggi",
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
  const benefits = [conflictingLocal, compatibleNational, compatibleGyeonggi];
  const statusById = new Map<string, EligibilityStatus>(benefits.map((b) => [b.id, "unknown"]));

  it("excludes the unresolved-other-region conflicted benefit from Home needsReview when the gate is enabled", () => {
    const needsReview = getUnknownBenefits(benefits, statusById, profile, benefits.length, {
      excludeLocalScopeConflicts: true,
    });
    expect(needsReview.map((b) => b.id)).not.toContain("conflicting-local");
  });

  it("keeps compatible national and compatible-region benefits in Home needsReview", () => {
    const needsReview = getUnknownBenefits(benefits, statusById, profile, benefits.length, {
      excludeLocalScopeConflicts: true,
    });
    const ids = needsReview.map((b) => b.id);
    expect(ids).toContain("compatible-national");
    expect(ids).toContain("compatible-gyeonggi");
  });

  it("refills the preview up to `limit` from the next eligible candidate instead of shrinking below it", () => {
    const needsReview = getUnknownBenefits(benefits, statusById, profile, 2, { excludeLocalScopeConflicts: true });
    // limit=2, one of the three candidates is conflicted -> both remaining compatible ones must fill the 2 slots.
    expect(needsReview).toHaveLength(2);
    expect(needsReview.map((b) => b.id).sort()).toEqual(["compatible-gyeonggi", "compatible-national"]);
  });

  it("does NOT mark the conflicted benefit not_eligible or mutate statusById", () => {
    getUnknownBenefits(benefits, statusById, profile, benefits.length, { excludeLocalScopeConflicts: true });
    expect(statusById.get("conflicting-local")).toBe("unknown");
  });

  it("without the gate (default false), the conflicted benefit remains present — full discovery/browse behavior is unchanged", () => {
    const fullDiscovery = getUnknownBenefits(benefits, statusById, profile, benefits.length);
    expect(fullDiscovery.map((b) => b.id)).toContain("conflicting-local");
  });
});
