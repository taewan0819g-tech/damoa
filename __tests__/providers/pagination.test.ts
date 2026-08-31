import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the "first 500 records only" bug: both providers used
 * to cap themselves at a single page (MOIS: 500 records, Youth: 500
 * records) regardless of how much data the upstream API actually had. This
 * test simulates an upstream catalog bigger than that old cap and asserts
 * a record past record #500 is still returned by getBenefits().
 */

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("MOISBenefitProvider pagination", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
  });

  it("paginates past the old 500-record cutoff and the full catalog is discoverable", async () => {
    const TOTAL = 1500;

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/supportConditions")) {
        return jsonResponse({ currentCount: 0, data: [], matchCount: 0, page: 1, perPage: 1000, totalCount: 0 });
      }
      if (url.pathname.endsWith("/serviceList")) {
        const page = Number(url.searchParams.get("page"));
        const perPage = Number(url.searchParams.get("perPage"));
        const start = (page - 1) * perPage;
        const end = Math.min(start + perPage, TOTAL);
        const data = Array.from({ length: Math.max(0, end - start) }, (_, i) => {
          const n = start + i + 1;
          return {
            서비스ID: `svc-${n}`,
            서비스명: `Service ${n}`,
            소관기관명: "Test Org",
          };
        });
        return jsonResponse({ currentCount: data.length, data, matchCount: TOTAL, page, perPage, totalCount: TOTAL });
      }
      throw new Error(`Unexpected URL in test: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { MOISBenefitProvider } = await import("@/providers/MOISBenefitProvider");
    const provider = new MOISBenefitProvider();
    const benefits = await provider.getBenefits();

    expect(benefits).toHaveLength(TOTAL);
    // Record #1200 is well past the old 500-record cap.
    expect(benefits.some((b) => b.id === "mois-svc-1200")).toBe(true);
    expect(benefits.some((b) => b.id === "mois-svc-1500")).toBe(true);
  });
});

describe("YouthCenterBenefitProvider pagination", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.YOUTH_POLICY_API_KEY = "test-key";
  });

  it("paginates past the old 500-record cutoff and the full catalog is discoverable", async () => {
    const TOTAL = 1500;

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const pageNum = Number(url.searchParams.get("pageNum"));
      const pageSize = Number(url.searchParams.get("pageSize"));
      const start = (pageNum - 1) * pageSize;
      const end = Math.min(start + pageSize, TOTAL);
      const youthPolicyList = Array.from({ length: Math.max(0, end - start) }, (_, i) => {
        const n = start + i + 1;
        return { plcyNo: `plcy-${n}`, plcyNm: `Policy ${n}` };
      });
      return jsonResponse({
        resultCode: 200,
        resultMessage: "OK",
        result: { pagging: { totCount: TOTAL, pageNum, pageSize }, youthPolicyList },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { YouthCenterBenefitProvider } = await import("@/providers/YouthCenterBenefitProvider");
    const provider = new YouthCenterBenefitProvider();
    const benefits = await provider.getBenefits();

    expect(benefits).toHaveLength(TOTAL);
    expect(benefits.some((b) => b.id === "youth-plcy-1200")).toBe(true);
    expect(benefits.some((b) => b.id === "youth-plcy-1500")).toBe(true);
  });
});
