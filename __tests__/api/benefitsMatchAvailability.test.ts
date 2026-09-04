import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogWithIndex } from "@/providers";
import type { ProviderHealth } from "@/providers/health";
import { buildCandidateIndex } from "@/lib/eligibility/candidateIndex";

/**
 * Phase 5 (Production Stabilization) §19 item 11 regression coverage: when
 * there is no usable provider data at all (every registered provider
 * reports "unavailable"), the match route must fail fast with 503 rather
 * than silently returning an empty-looking "successful" result. Also
 * guards the vacuous-truth pitfall the other direction: an EMPTY health
 * array (e.g. only MockBenefitProvider registered, which always reports
 * healthy) must NOT be misread as "everything is down".
 */

const mockGetCatalogWithCandidateIndex = vi.fn<() => Promise<CatalogWithIndex>>();
const mockGetProviderHealth = vi.fn<() => ProviderHealth[]>();

vi.mock("@/providers", () => ({
  benefitProvider: {
    getBenefits: vi.fn(async () => []),
    getBenefit: vi.fn(async () => null),
  },
  getCatalogWithCandidateIndex: mockGetCatalogWithCandidateIndex,
  getProviderHealth: mockGetProviderHealth,
}));

function emptyCatalog(): CatalogWithIndex {
  const index = buildCandidateIndex([]);
  return {
    benefits: [],
    index,
    expiredBenefits: [],
    expiredIndex: index,
    upcomingBenefits: [],
    counts: {
      sourceCatalogCount: 0,
      activeCount: 0,
      upcomingCount: 0,
      expiredCount: 0,
      dateUnknownCount: 0,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCatalogWithCandidateIndex.mockResolvedValue(emptyCatalog());
});

afterEach(() => {
  vi.resetModules();
});

describe("POST /api/benefits/match availability guard (§19 item 11)", () => {
  it("returns 503 when every registered provider reports 'unavailable' (no last-known-good data anywhere)", async () => {
    mockGetProviderHealth.mockReturnValue([
      {
        provider: "mois",
        configured: true,
        status: "unavailable",
        lastAttemptAt: Date.now(),
        lastSuccessAt: null,
        lastFailureAt: Date.now(),
        lastError: "upstream down",
        ageMs: null,
        isStale: false,
        refreshInFlight: false,
        currentCatalogCount: null,
      },
    ]);

    const { POST } = await import("@/app/api/benefits/match/route");
    const res = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));

    expect(res.status).toBe(503);
  });

  it("does NOT return 503 when the health array is empty -- vacuous truth guard", async () => {
    mockGetProviderHealth.mockReturnValue([]);

    const { POST } = await import("@/app/api/benefits/match/route");
    const res = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));

    expect(res.status).toBe(200);
  });

  it("does NOT return 503 when at least one provider is healthy/stale, even if another is unavailable", async () => {
    mockGetProviderHealth.mockReturnValue([
      {
        provider: "mois",
        configured: true,
        status: "unavailable",
        lastAttemptAt: Date.now(),
        lastSuccessAt: null,
        lastFailureAt: Date.now(),
        lastError: "upstream down",
        ageMs: null,
        isStale: false,
        refreshInFlight: false,
        currentCatalogCount: null,
      },
      {
        provider: "youth-center",
        configured: true,
        status: "healthy",
        lastAttemptAt: Date.now(),
        lastSuccessAt: Date.now(),
        lastFailureAt: null,
        lastError: null,
        ageMs: 10,
        isStale: false,
        refreshInFlight: false,
        currentCatalogCount: 42,
      },
    ]);

    const { POST } = await import("@/app/api/benefits/match/route");
    const res = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));

    expect(res.status).toBe(200);
  });
});
