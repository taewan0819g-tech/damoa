import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Benefit } from "@/types/benefit";
// Renamed to satisfy vitest's vi.mock hoisting rule (only identifiers
// prefixed with "mock" may be referenced inside a vi.mock factory). These are
// the REAL production candidate-index/active-catalog builders, not stubs —
// using them here means these route tests exercise the actual
// candidate-retrieval and application-window-classification layers
// end-to-end, which matters because pruning/classification is only a valid
// optimization if it never changes the final personalized result (see the
// assertions below).
import { buildCandidateIndex as mockBuildCandidateIndex } from "@/lib/eligibility/candidateIndex";
import { classifyCatalog as mockClassifyCatalog } from "@/lib/catalog/activeCatalog";
import type { CatalogWithIndex } from "@/providers";

const BULK_COUNT = 550; // comfortably past the old "first 500 records only" cutoff

const bulkBenefits: Benefit[] = Array.from({ length: BULK_COUNT }, (_, i) => ({
  id: `bulk-${i + 1}`,
  title: `Bulk benefit ${i + 1}`,
  shortDescription: "desc",
  category: "welfare",
  source: { type: "government", organization: "org" },
  benefitType: "other",
  eligibilityUnrestricted: true,
}));

const mockBenefits: Benefit[] = [
  {
    // Zero structured eligibility data at all -> unknown with zero evidence.
    // Uninformative for every user alike, so it must never appear in the
    // personalized feed (excluded, not "unknown").
    id: "no-rules",
    title: "No structured rules",
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
  },
  {
    id: "unrestricted",
    title: "Open to everyone",
    shortDescription: "desc",
    category: "welfare",
    source: { type: "bank", organization: "org" },
    benefitType: "deposit",
    eligibilityUnrestricted: true,
  },
  {
    id: "age-19-34",
    title: "Youth-only",
    shortDescription: "desc",
    category: "employment",
    source: { type: "youth_policy", organization: "org" },
    benefitType: "cash",
    eligibility: {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [19, 34], required: true }],
    },
  },
  {
    id: "age-90-99",
    title: "Never matches a real applicant",
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
    eligibility: {
      type: "all",
      rules: [{ id: "age", field: "age", operator: "between", value: [90, 99], required: true }],
    },
  },
  {
    // One rule resolves against the profile (age), one required rule can
    // never resolve (a field the test profile never sets) -> overall status
    // stays "unknown", but hasEvidence is true because the age rule was
    // actually compared. Must still be surfaced — a real partial match is
    // useful signal, unlike "no-rules" above.
    id: "mixed-evidence-unknown",
    title: "Partially evaluable",
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
    eligibility: {
      type: "all",
      rules: [
        { id: "age", field: "age", operator: "between", value: [19, 34], required: true },
        { id: "region", field: "residence.province", operator: "eq", value: "제주특별자치도", required: true },
      ],
    },
  },
  {
    // Definitely eligible, but its application window already closed --
    // excluded from the default feed even though it's a real match.
    id: "closed-but-eligible",
    title: "Closed application window",
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
    eligibilityUnrestricted: true,
    application: { endDate: "2000-01-01" },
  },
];

/**
 * Builds the same `CatalogWithIndex` shape providers/index.ts's
 * `getCatalogWithCandidateIndex` returns, using the REAL classification and
 * candidate-index builders instead of hand-constructing the split — this way
 * these tests exercise the actual active/upcoming/expired/date_unknown split
 * (section 1/23) together with candidate retrieval, not a fake stand-in.
 */
function buildMockCatalog(benefits: Benefit[]): CatalogWithIndex {
  const classified = mockClassifyCatalog(benefits);
  const personalizable = [...classified.active, ...classified.dateUnknown];
  return {
    benefits: personalizable,
    index: mockBuildCandidateIndex(personalizable),
    expiredBenefits: classified.expired,
    expiredIndex: mockBuildCandidateIndex(classified.expired),
    upcomingBenefits: classified.upcoming,
    counts: {
      sourceCatalogCount: benefits.length,
      activeCount: classified.active.length,
      upcomingCount: classified.upcoming.length,
      expiredCount: classified.expired.length,
      dateUnknownCount: classified.dateUnknown.length,
    },
  };
}

const mockGetCatalogWithCandidateIndex = vi.fn<() => Promise<CatalogWithIndex>>();

vi.mock("@/providers", () => ({
  benefitProvider: {
    getBenefits: vi.fn(async () => []),
    getBenefit: vi.fn(async () => null),
  },
  getCatalogWithCandidateIndex: mockGetCatalogWithCandidateIndex,
  // Empty array = skip the route's "all providers unavailable" 503 check
  // entirely (see providers/index.ts's vacuous-truth guard) -- preserves
  // existing test behavior; specific health scenarios are covered by
  // dedicated tests instead of overriding this shared mock.
  getProviderHealth: vi.fn(() => []),
}));

describe("POST /api/benefits/match (non-paginated, bounded home-summary shape)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Small, fully-named dataset only — small enough that every relevant
    // item fits inside HOME_PREVIEW_LIMIT, so per-ID assertions below stay
    // meaningful (see the separate "bounded preview" describe block for
    // explicit over-the-cap coverage).
    mockGetCatalogWithCandidateIndex.mockImplementation(async () => buildMockCatalog(mockBenefits));
  });

  it("returns the bounded summary shape — never a full catalog and never a not_eligible benefit", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const json = await res.json();

    // The old response shapes must be gone entirely.
    expect(json.benefits).toBeUndefined();
    expect(json.matches).toBeUndefined();
    expect(json.likelyEligible).toBeUndefined();
    expect(json.unknown).toBeUndefined();

    expect(Array.isArray(json.recommended)).toBe(true);
    expect(Array.isArray(json.needsReview)).toBe(true);
    expect(json.summary).toBeDefined();
    expect(typeof json.statuses).toBe("object");

    const returnedIds = new Set([...json.recommended, ...json.needsReview].map((b: Benefit) => b.id));
    expect(returnedIds.has("age-90-99")).toBe(false); // not_eligible for a 25-year-old — must never be sent
    expect(json.recommended.length + json.needsReview.length).toBeLessThan(mockBenefits.length);
  });

  it("reports accurate counts that fully account for the catalog via likelyEligible+unknown+notEligible+excluded", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();

    // Dataset is small enough that the full relevant set fits inside the
    // preview caps, so likelyEligible+unknown (computed server-side over the
    // FULL relevant set) equals exactly what's echoed back in the previews.
    expect(json.counts.likelyEligible + json.counts.unknown).toBe(json.recommended.length);
    expect(json.counts.unknown).toBe(json.needsReview.length);
    expect(json.counts.totalEvaluated).toBe(mockBenefits.length);
    expect(json.counts.likelyEligible + json.counts.unknown + json.counts.notEligible + json.counts.excluded).toBe(
      mockBenefits.length
    );
    expect(json.counts.notEligible).toBeGreaterThan(0);
    expect(json.counts.excluded).toBeGreaterThan(0);
  });

  it("prunes verified-necessary-rule conflicts via the candidate index instead of running every record through the full rule engine", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    // age-90-99 has a hard `required: true` age range that a 25-year-old
    // definitely fails -> the candidate index should prune it before the
    // full rule engine ever runs, so candidatesEvaluated < totalEvaluated.
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();

    expect(json.counts.candidatesEvaluated).toBeLessThan(json.counts.totalEvaluated);
    expect(json.counts.candidatesEvaluated).toBeGreaterThan(0);
  });

  it("classifies statuses correctly: unrestricted/passing rules -> likely_eligible", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();

    expect(json.statuses["unrestricted"]).toBe("likely_eligible");
    expect(json.statuses["age-19-34"]).toBe("likely_eligible");
    const recommendedIds = new Set(json.recommended.map((b: Benefit) => b.id));
    expect(recommendedIds.has("unrestricted")).toBe(true);
    expect(recommendedIds.has("age-19-34")).toBe(true);
  });

  it("excludes a zero-evidence unknown (no structured eligibility data at all) from both buckets", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();
    const allReturnedIds = new Set([...json.recommended, ...json.needsReview].map((b: Benefit) => b.id));
    expect(allReturnedIds.has("no-rules")).toBe(false);
  });

  it("excludes a benefit whose only required rule can't resolve (missing field -> zero evidence) even though overall status is unknown", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(request);
    const json = await res.json();
    const allReturnedIds = new Set([...json.recommended, ...json.needsReview].map((b: Benefit) => b.id));
    expect(allReturnedIds.has("age-19-34")).toBe(false);
  });

  it("still surfaces an unknown benefit that has real positive partial evidence (one rule passed, another unresolved)", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();
    expect(json.statuses["mixed-evidence-unknown"]).toBe("unknown");
    const needsReviewIds = new Set(json.needsReview.map((b: Benefit) => b.id));
    expect(needsReviewIds.has("mixed-evidence-unknown")).toBe(true);
  });

  it("excludes a closed benefit from the default feed even when it's a definite match", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" });

    const res = await POST(request);
    const json = await res.json();
    const allReturnedIds = new Set([...json.recommended, ...json.needsReview].map((b: Benefit) => b.id));
    expect(allReturnedIds.has("closed-but-eligible")).toBe(false);
    expect(json.counts.expiredCatalogCount).toBe(1);
  });

  it("includes a closed benefit when includeClosed: true is passed", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ includeClosed: true }),
    });

    const res = await POST(request);
    const json = await res.json();
    const recommendedIds = new Set(json.recommended.map((b: Benefit) => b.id));
    expect(recommendedIds.has("closed-but-eligible")).toBe(true);
  });

  it("returns not_eligible (i.e. excludes) a benefit whose rule the profile fails, and changes results when the profile changes", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");

    const youngReq = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${new Date().getFullYear() - 25}-01-01` }),
    });
    const oldReq = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${new Date().getFullYear() - 60}-01-01` }),
    });

    const youngJson = await (await POST(youngReq)).json();
    const oldJson = await (await POST(oldReq)).json();

    const youngIds = new Set([...youngJson.recommended, ...youngJson.needsReview].map((b: Benefit) => b.id));
    const oldIds = new Set([...oldJson.recommended, ...oldJson.needsReview].map((b: Benefit) => b.id));

    expect(youngIds.has("age-19-34")).toBe(true);
    expect(oldIds.has("age-19-34")).toBe(false); // now not_eligible for a 60-year-old, so excluded
  });

  it("rejects a malformed profile with 400", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ childrenCount: -1 }),
    });

    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("defaults to an empty profile when the body is empty/malformed JSON", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", { method: "POST", body: "" });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.counts.totalEvaluated).toBe(mockBenefits.length);
  });
});

describe("POST /api/benefits/match (bounded home preview cap, section 20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never returns more than the preview limit per bucket even when far more benefits are relevant", async () => {
    const manyUnrestricted: Benefit[] = Array.from({ length: 40 }, (_, i) => ({
      id: `many-${i + 1}`,
      title: `Open benefit ${i + 1}`,
      shortDescription: "desc",
      category: "welfare",
      source: { type: "government", organization: "org" },
      benefitType: "other",
      eligibilityUnrestricted: true,
    }));
    mockGetCatalogWithCandidateIndex.mockImplementation(async () => buildMockCatalog(manyUnrestricted));

    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" });

    const res = await POST(request);
    const json = await res.json();

    // All 40 are likely_eligible (uninformative aggregate), but the preview
    // array actually sent to the browser must stay bounded.
    expect(json.counts.likelyEligible).toBe(40);
    expect(json.recommended.length).toBeLessThanOrEqual(10);
  });
});

describe("POST /api/benefits/match (paginated mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Combines the small named dataset with the large bulk dataset — the
    // paginated listing page is the one that must keep discovering records
    // well past the old 500-record cutoff, unlike the bounded home preview.
    mockGetCatalogWithCandidateIndex.mockImplementation(async () => buildMockCatalog([...mockBenefits, ...bulkBenefits]));
  });

  it("switches to the paginated shape when page/pageSize is present, and paginates the relevant set", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ profile: { birthDate: `${new Date().getFullYear() - 25}-01-01` }, page: 1, pageSize: 10 }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.recommended).toBeUndefined();
    expect(json.needsReview).toBeUndefined();
    expect(Array.isArray(json.benefits)).toBe(true);
    expect(json.benefits.length).toBe(10);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(10);
    expect(json.total).toBeGreaterThan(10);
    expect(json.totalPages).toBeGreaterThan(1);
    for (const b of json.benefits) {
      expect(typeof json.statuses[b.id]).toBe("string");
    }
  });

  it("returns different records on page 2 than page 1, with no overlap", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const makeReq = (page: number) =>
      new Request("http://localhost/api/benefits/match", {
        method: "POST",
        body: JSON.stringify({ profile: {}, page, pageSize: 10, sort: "latest" }),
      });

    const page1 = await (await POST(makeReq(1))).json();
    const page2 = await (await POST(makeReq(2))).json();

    const ids1 = new Set(page1.benefits.map((b: Benefit) => b.id));
    const ids2 = new Set(page2.benefits.map((b: Benefit) => b.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
  });

  it("applies server-side search over the relevant set", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({
        profile: { birthDate: `${birthYear}-01-01` },
        page: 1,
        pageSize: 20,
        search: "Youth-only",
      }),
    });

    const res = await POST(request);
    const json = await res.json();
    expect(json.benefits.length).toBe(1);
    expect(json.benefits[0].id).toBe("age-19-34");
  });

  it("applies server-side group and category filters over the relevant set", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ profile: {}, page: 1, pageSize: 20, group: "financial" }),
    });

    const res = await POST(request);
    const json = await res.json();
    expect(json.benefits.every((b: Benefit) => b.source.type === "bank")).toBe(true);
  });

  it("clamps pageSize to the max and page to at least 1", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ profile: {}, page: 0, pageSize: 9999 }),
    });

    const res = await POST(request);
    const json = await res.json();
    expect(json.page).toBe(1);
    expect(json.pageSize).toBeLessThanOrEqual(50);
  });

  it("still excludes zero-evidence unknown and closed benefits from the paginated relevant set", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ profile: {}, page: 1, pageSize: BULK_COUNT + 10, search: "" }),
    });

    const res = await POST(request);
    const json = await res.json();
    const ids = new Set(json.benefits.map((b: Benefit) => b.id));
    expect(ids.has("no-rules")).toBe(false);
    expect(ids.has("closed-but-eligible")).toBe(false);
  });

  it("keeps discovering records well past the old 500-record cutoff via pagination (not the bounded home preview)", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ profile: {}, page: 1, pageSize: 20, search: `Bulk benefit ${BULK_COUNT}` }),
    });

    const res = await POST(request);
    const json = await res.json();
    expect(json.benefits.some((b: Benefit) => b.id === `bulk-${BULK_COUNT}`)).toBe(true);

    const totalsRequest = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ profile: {}, page: 1, pageSize: 1 }),
    });
    const totalsJson = await (await POST(totalsRequest)).json();
    expect(totalsJson.total).toBeGreaterThan(500);
  });
});
