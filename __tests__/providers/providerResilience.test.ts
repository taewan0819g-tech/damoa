import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Benefit } from "@/types/benefit";

/**
 * Phase 5 (Production Stabilization) §19 regression coverage for
 * provider-layer resilience behaviors not already covered by
 * __tests__/cache/resilientCache.test.ts or __tests__/http/httpClient.test.ts:
 *   (7)  a partial-pagination failure never returns/caches a partial catalog
 *   (9)  one provider failing never prevents another provider's data from
 *        reaching the merged catalog (provider isolation)
 *   (10) provider health reports "stale" (degraded) once a refresh fails
 *        after previously succeeding -- the last-known-good data is still
 *        served, but health reflects that it's no longer fresh
 *   (12) a provider's runtime failure never causes MockBenefitProvider data
 *        to appear when a real API key is configured (no silent demo-data
 *        backfill)
 * No live upstream API is used anywhere in this file -- `fetch` is always
 * stubbed (§15).
 */

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

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
  vi.unstubAllGlobals();
  vi.doUnmock("@/providers/MOISBenefitProvider");
  vi.doUnmock("@/providers/YouthCenterBenefitProvider");
  vi.useRealTimers();
  vi.resetModules();
});

describe("MOISBenefitProvider pagination atomicity", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
  });

  it("(7) a page failure partway through pagination never returns a partial catalog", async () => {
    const TOTAL = 1500; // 2 pages at PER_PAGE=1000
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/supportConditions")) {
        return jsonResponse({ currentCount: 0, data: [], matchCount: 0, page: 1, perPage: 1000, totalCount: 0 });
      }
      if (url.pathname.endsWith("/serviceList")) {
        const page = Number(url.searchParams.get("page"));
        if (page === 2) {
          // Deterministic (non-retryable) failure on the second page, AFTER
          // page 1 already succeeded and pushed 1000 records into the
          // in-progress results array.
          return jsonResponse({ error: "bad request" }, 400);
        }
        const perPage = Number(url.searchParams.get("perPage"));
        const data = Array.from({ length: perPage }, (_, i) => ({
          서비스ID: `svc-${i + 1}`,
          서비스명: `Service ${i + 1}`,
          소관기관명: "Test Org",
        }));
        return jsonResponse({ currentCount: data.length, data, matchCount: TOTAL, page, perPage, totalCount: TOTAL });
      }
      throw new Error(`Unexpected URL in test: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { MOISBenefitProvider } = await import("@/providers/MOISBenefitProvider");
    const provider = new MOISBenefitProvider();
    const benefits = await provider.getBenefits();

    // The 1000 records from the successful page 1 must NEVER leak out as a
    // "partial catalog" -- a failed pagination run must surface as
    // "no usable data this refresh" (empty), not silently-truncated data.
    expect(benefits).toEqual([]);
  });
});

describe("Provider isolation and mock-insertion guard", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
    process.env.YOUTH_POLICY_API_KEY = "test-key";
  });

  it("(9) one provider failing entirely never prevents another provider's benefits from reaching the merged catalog", async () => {
    vi.doMock("@/providers/MOISBenefitProvider", () => ({
      MOISBenefitProvider: vi.fn().mockImplementation(function () {
        return {
          getBenefits: vi.fn(async () => {
            throw new Error("MOIS is down");
          }),
          getBenefit: vi.fn(async () => null),
        };
      }),
    }));
    vi.doMock("@/providers/YouthCenterBenefitProvider", () => ({
      YouthCenterBenefitProvider: vi.fn().mockImplementation(function () {
        return {
          getBenefits: vi.fn(async () => [benefit("youth-a"), benefit("youth-b")]),
          getBenefit: vi.fn(async () => null),
        };
      }),
    }));

    const { benefitProvider } = await import("@/providers");
    const merged = await benefitProvider.getBenefits();

    expect(merged.map((b) => b.id).sort()).toEqual(["youth-a", "youth-b"]);
  });

  it("(12) a real provider's runtime failure never causes MockBenefitProvider data to appear when a real key is configured", async () => {
    delete process.env.YOUTH_POLICY_API_KEY; // only MOIS configured
    vi.doMock("@/providers/MOISBenefitProvider", () => ({
      MOISBenefitProvider: vi.fn().mockImplementation(function () {
        return {
          getBenefits: vi.fn(async () => {
            throw new Error("MOIS is down");
          }),
          getBenefit: vi.fn(async () => null),
        };
      }),
    }));

    const { benefitProvider } = await import("@/providers");
    const { mockBenefits } = await import("@/data/mockBenefits");
    const merged = await benefitProvider.getBenefits();

    expect(merged).toEqual([]);
    // None of the demo/mock catalog's ids leaked into the result.
    const mockIds = new Set((mockBenefits as { id: string }[]).map((b) => b.id));
    expect(merged.some((b) => mockIds.has(b.id))).toBe(false);
  });
});

describe("Provider health degrades to 'stale' after a previously-successful catalog goes stale-if-error", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
  });

  it("(10) reports 'healthy' after a good fetch, then 'stale' after a later refresh fails (still serving last-known-good)", async () => {
    vi.useFakeTimers();
    let phase: "ok" | "fail" = "ok";
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/supportConditions")) {
        return jsonResponse({ currentCount: 0, data: [], matchCount: 0, page: 1, perPage: 1000, totalCount: 0 });
      }
      if (url.pathname.endsWith("/serviceList")) {
        if (phase === "fail") {
          return jsonResponse({ error: "bad request" }, 400); // deterministic, no retry delay involved
        }
        const data = [{ 서비스ID: "s1", 서비스명: "Test", 소관기관명: "org" }];
        return jsonResponse({ currentCount: 1, data, matchCount: 1, page: 1, perPage: 1000, totalCount: 1 });
      }
      throw new Error(`Unexpected URL in test: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { MOISBenefitProvider } = await import("@/providers/MOISBenefitProvider");
    const provider = new MOISBenefitProvider();

    const first = await provider.getBenefits();
    expect(first).toHaveLength(1);
    expect(provider.getHealthStatus().status).toBe("healthy");

    phase = "fail";
    vi.advanceTimersByTime(3_600_000 + 1_000); // past the 1-hour cache TTL

    const second = await provider.getBenefits();
    expect(second).toEqual(first); // stale-if-error: identical last-known-good data served
    expect(provider.getHealthStatus().status).toBe("stale");
  });
});
