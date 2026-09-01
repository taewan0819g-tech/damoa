import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Benefit } from "@/types/benefit";

/**
 * Regression tests for the catalog + candidate-index caching contract in
 * providers/index.ts: the merged catalog array reference (and therefore the
 * CandidateIndex built over it) must stay STABLE across calls for as long as
 * every underlying provider's own cache is unchanged, and must only be
 * rebuilt when at least one provider's cache actually refreshes (a new
 * array reference). This is what lets `buildCandidateIndex` run once per
 * catalog refresh instead of once per personalized request.
 */

const ORIGINAL_ENV = { ...process.env };

function benefit(id: string): Benefit {
  return {
    id,
    title: id,
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.doUnmock("@/providers/MOISBenefitProvider");
  vi.doUnmock("@/providers/YouthCenterBenefitProvider");
  vi.resetModules();
});

describe("getCatalogWithCandidateIndex caching", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
    delete process.env.YOUTH_POLICY_API_KEY;
  });

  it("reuses the same catalog and index object references across calls when the provider's cache hasn't changed", async () => {
    const stableArray = [benefit("a"), benefit("b")];
    const getBenefits = vi.fn(async () => stableArray);
    vi.doMock("@/providers/MOISBenefitProvider", () => ({
      MOISBenefitProvider: vi.fn().mockImplementation(function () {
        return { getBenefits, getBenefit: vi.fn(async () => null) };
      }),
    }));

    const { getCatalogWithCandidateIndex } = await import("@/providers");

    const first = await getCatalogWithCandidateIndex();
    const second = await getCatalogWithCandidateIndex();
    const third = await getCatalogWithCandidateIndex();

    // The underlying provider was queried every time (per-request), but its
    // own result reference never changed, so the merged catalog reference
    // and the derived index must be reused, not rebuilt.
    expect(getBenefits).toHaveBeenCalledTimes(3);
    expect(second.benefits).toBe(first.benefits);
    expect(third.benefits).toBe(first.benefits);
    expect(second.index).toBe(first.index);
    expect(third.index).toBe(first.index);
  });

  it("rebuilds the catalog and index only when the underlying provider's result reference actually changes", async () => {
    let current: Benefit[] = [benefit("a")];
    const getBenefits = vi.fn(async () => current);
    vi.doMock("@/providers/MOISBenefitProvider", () => ({
      MOISBenefitProvider: vi.fn().mockImplementation(function () {
        return { getBenefits, getBenefit: vi.fn(async () => null) };
      }),
    }));

    const { getCatalogWithCandidateIndex } = await import("@/providers");

    const first = await getCatalogWithCandidateIndex();
    expect(first.benefits.map((b) => b.id)).toEqual(["a"]);

    // Same reference again -> cache hit.
    const stillCached = await getCatalogWithCandidateIndex();
    expect(stillCached.benefits).toBe(first.benefits);
    expect(stillCached.index).toBe(first.index);

    // Simulate the provider's own memoized cache actually refreshing
    // (a genuinely new array reference with different content).
    current = [benefit("a"), benefit("c")];
    const refreshed = await getCatalogWithCandidateIndex();

    expect(refreshed.benefits).not.toBe(first.benefits);
    expect(refreshed.benefits.map((b) => b.id).sort()).toEqual(["a", "c"]);
    expect(refreshed.index).not.toBe(first.index);
    expect(refreshed.index.totalCount).toBe(2);
  });

  it("only reuses the merged reference when EVERY provider's own array is unchanged, across multiple providers", async () => {
    process.env.YOUTH_POLICY_API_KEY = "test-key";

    const moisArray: Benefit[] = [benefit("mois-a")];
    let youthArray: Benefit[] = [benefit("youth-a")];
    const moisGetBenefits = vi.fn(async () => moisArray);
    const youthGetBenefits = vi.fn(async () => youthArray);

    vi.doMock("@/providers/MOISBenefitProvider", () => ({
      MOISBenefitProvider: vi.fn().mockImplementation(function () {
        return { getBenefits: moisGetBenefits, getBenefit: vi.fn(async () => null) };
      }),
    }));
    vi.doMock("@/providers/YouthCenterBenefitProvider", () => ({
      YouthCenterBenefitProvider: vi.fn().mockImplementation(function () {
        return { getBenefits: youthGetBenefits, getBenefit: vi.fn(async () => null) };
      }),
    }));

    const { getCatalogWithCandidateIndex } = await import("@/providers");

    const first = await getCatalogWithCandidateIndex();
    expect(first.benefits.map((b) => b.id).sort()).toEqual(["mois-a", "youth-a"]);

    // Only the Youth provider's cache refreshes; MOIS stays the same
    // reference. The merged array must still be rebuilt (it's a new
    // combination), but this proves `sameInputs` is checking every input,
    // not just the first one.
    youthArray = [benefit("youth-a"), benefit("youth-b")];
    const second = await getCatalogWithCandidateIndex();

    expect(second.benefits).not.toBe(first.benefits);
    expect(second.benefits.map((b) => b.id).sort()).toEqual(["mois-a", "youth-a", "youth-b"]);
    expect(second.index).not.toBe(first.index);
    expect(second.index.totalCount).toBe(3);

    // Now nothing changes -> back to a stable reference.
    const third = await getCatalogWithCandidateIndex();
    expect(third.benefits).toBe(second.benefits);
    expect(third.index).toBe(second.index);
  });
});
