import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Benefit } from "@/types/benefit";
// Renamed to satisfy vitest's vi.mock hoisting rule (only identifiers
// prefixed with "mock" may be referenced inside a vi.mock factory). This is
// the REAL production index builder, not a stub — using it here means these
// route tests exercise the actual candidate-retrieval layer end-to-end,
// which matters because pruning is only a valid optimization if it never
// changes the final personalized result (see the assertions below).
import { buildCandidateIndex as mockBuildCandidateIndex } from "@/lib/eligibility/candidateIndex";

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
  ...bulkBenefits,
];

vi.mock("@/providers", () => ({
  benefitProvider: {
    getBenefits: vi.fn(async () => mockBenefits),
    getBenefit: vi.fn(async () => null),
  },
  getCatalogWithCandidateIndex: vi.fn(async () => ({
    benefits: mockBenefits,
    index: mockBuildCandidateIndex(mockBenefits),
  })),
}));

describe("POST /api/benefits/match (non-paginated default feed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only likelyEligible/unknown/counts — never a full catalog and never a not_eligible benefit", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const json = await res.json();

    // The old response shape ({ benefits, matches }) must be gone entirely.
    expect(json.benefits).toBeUndefined();
    expect(json.matches).toBeUndefined();

    const returnedIds = new Set([...json.likelyEligible, ...json.unknown].map((b: Benefit) => b.id));
    expect(returnedIds.has("age-90-99")).toBe(false); // not_eligible for a 25-year-old — must never be sent
    expect(json.likelyEligible.length + json.unknown.length).toBeLessThan(mockBenefits.length);
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

    expect(json.counts.likelyEligible).toBe(json.likelyEligible.length);
    expect(json.counts.unknown).toBe(json.unknown.length);
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
    const likelyIds = new Set(json.likelyEligible.map((b: Benefit) => b.id));

    expect(likelyIds.has("unrestricted")).toBe(true);
    expect(likelyIds.has("age-19-34")).toBe(true);
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
    const allReturnedIds = new Set([...json.likelyEligible, ...json.unknown].map((b: Benefit) => b.id));
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
    const allReturnedIds = new Set([...json.likelyEligible, ...json.unknown].map((b: Benefit) => b.id));
    expect(allReturnedIds.has("age-19-34")).toBe(false);
  });

  it("still surfaces an unknown benefit that has real partial evidence (one rule resolved, another unresolved)", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();
    const unknownIds = new Set(json.unknown.map((b: Benefit) => b.id));
    expect(unknownIds.has("mixed-evidence-unknown")).toBe(true);
  });

  it("excludes a closed benefit from the default feed even when it's a definite match", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" });

    const res = await POST(request);
    const json = await res.json();
    const allReturnedIds = new Set([...json.likelyEligible, ...json.unknown].map((b: Benefit) => b.id));
    expect(allReturnedIds.has("closed-but-eligible")).toBe(false);
  });

  it("includes a closed benefit when includeClosed: true is passed", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ includeClosed: true }),
    });

    const res = await POST(request);
    const json = await res.json();
    const likelyIds = new Set(json.likelyEligible.map((b: Benefit) => b.id));
    expect(likelyIds.has("closed-but-eligible")).toBe(true);
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

    const youngIds = new Set([...youngJson.likelyEligible, ...youngJson.unknown].map((b: Benefit) => b.id));
    const oldIds = new Set([...oldJson.likelyEligible, ...oldJson.unknown].map((b: Benefit) => b.id));

    expect(youngIds.has("age-19-34")).toBe(true);
    expect(oldIds.has("age-19-34")).toBe(false); // now not_eligible for a 60-year-old, so excluded
  });

  it("keeps discovering records well past the old 500-record cutoff", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" });

    const res = await POST(request);
    const json = await res.json();
    const likelyIds = new Set(json.likelyEligible.map((b: Benefit) => b.id));

    expect(likelyIds.has("bulk-520")).toBe(true);
    expect(likelyIds.has(`bulk-${BULK_COUNT}`)).toBe(true);
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

describe("POST /api/benefits/match (paginated mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(json.likelyEligible).toBeUndefined();
    expect(json.unknown).toBeUndefined();
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
});
