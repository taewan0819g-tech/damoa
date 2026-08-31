import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Benefit } from "@/types/benefit";

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
  ...bulkBenefits,
];

vi.mock("@/providers", () => ({
  benefitProvider: {
    getBenefits: vi.fn(async () => mockBenefits),
    getBenefit: vi.fn(async () => null),
  },
}));

describe("POST /api/benefits/match", () => {
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

  it("reports accurate counts, including notEligible as a number only (no objects)", async () => {
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
    expect(json.counts.likelyEligible + json.counts.unknown + json.counts.notEligible).toBe(mockBenefits.length);
    expect(json.counts.notEligible).toBeGreaterThan(0);
  });

  it("classifies statuses correctly: unrestricted/passing rules -> likely_eligible, no rules -> unknown", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();
    const likelyIds = new Set(json.likelyEligible.map((b: Benefit) => b.id));
    const unknownIds = new Set(json.unknown.map((b: Benefit) => b.id));

    expect(likelyIds.has("unrestricted")).toBe(true);
    expect(likelyIds.has("age-19-34")).toBe(true);
    expect(unknownIds.has("no-rules")).toBe(true);
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

  it("treats a benefit with missing required fields as unknown, not likely_eligible", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(request);
    const json = await res.json();
    const unknownIds = new Set(json.unknown.map((b: Benefit) => b.id));
    expect(unknownIds.has("age-19-34")).toBe(true);
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
