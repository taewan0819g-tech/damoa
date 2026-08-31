import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Benefit } from "@/types/benefit";

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

  it("returns the full catalog with a status per benefit for a valid profile", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 25;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.benefits).toHaveLength(3);
    const statusById = new Map(json.matches.map((m: { benefitId: string; status: string }) => [m.benefitId, m.status]));
    expect(statusById.get("no-rules")).toBe("unknown");
    expect(statusById.get("unrestricted")).toBe("likely_eligible");
    expect(statusById.get("age-19-34")).toBe("likely_eligible");
  });

  it("returns not_eligible for a benefit whose rule the profile fails", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const birthYear = new Date().getFullYear() - 60;
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({ birthDate: `${birthYear}-01-01` }),
    });

    const res = await POST(request);
    const json = await res.json();
    const statusById = new Map(json.matches.map((m: { benefitId: string; status: string }) => [m.benefitId, m.status]));
    expect(statusById.get("age-19-34")).toBe("not_eligible");
  });

  it("treats a benefit with missing required fields as unknown, not likely_eligible", async () => {
    const { POST } = await import("@/app/api/benefits/match/route");
    const request = new Request("http://localhost/api/benefits/match", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(request);
    const json = await res.json();
    const statusById = new Map(json.matches.map((m: { benefitId: string; status: string }) => [m.benefitId, m.status]));
    expect(statusById.get("age-19-34")).toBe("unknown");
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
    expect(json.benefits).toHaveLength(3);
  });
});
