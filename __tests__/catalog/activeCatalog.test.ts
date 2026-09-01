import { describe, expect, it } from "vitest";
import { classifyApplicationState, classifyCatalog } from "@/lib/catalog/activeCatalog";
import type { Benefit } from "@/types/benefit";

const REF_DATE = new Date("2026-09-01T00:00:00Z");

function benefitWithWindow(overrides: { startDate?: string; endDate?: string }): Pick<Benefit, "application"> {
  return { application: overrides };
}

/**
 * Section 1/23 of the constraint-compatibility spec: application-window
 * classification must never treat a missing/malformed date as "expired"
 * (that would wrongly hide a benefit from personalization), and must
 * separate "not open yet" (upcoming) from "already closed" (expired) so
 * candidate retrieval can safely skip only the latter by default.
 */
describe("classifyApplicationState", () => {
  it("classifies a known past end date as expired", () => {
    const state = classifyApplicationState(benefitWithWindow({ endDate: "2026-01-01" }), REF_DATE);
    expect(state).toBe("expired");
  });

  it("classifies today's end date as still active (not yet past)", () => {
    const state = classifyApplicationState(benefitWithWindow({ endDate: "2026-09-01" }), REF_DATE);
    expect(state).toBe("active");
  });

  it("classifies a known future end date as active", () => {
    const state = classifyApplicationState(benefitWithWindow({ endDate: "2026-12-31" }), REF_DATE);
    expect(state).toBe("active");
  });

  it("classifies a known future start date (not open yet) as upcoming", () => {
    const state = classifyApplicationState(benefitWithWindow({ startDate: "2026-12-01" }), REF_DATE);
    expect(state).toBe("upcoming");
  });

  it("a future end date always wins over a future start date when both happen to be present incorrectly (end date is the deciding signal)", () => {
    // startDate in the future AND endDate in the future: per
    // classifyApplicationState's documented order, a future start date
    // blocks "active" and produces "upcoming" — verifies the documented
    // precedence (upcoming checked before the generic "has end date -> active" fallback).
    const state = classifyApplicationState(
      benefitWithWindow({ startDate: "2026-10-01", endDate: "2027-01-01" }),
      REF_DATE
    );
    expect(state).toBe("upcoming");
  });

  it("classifies missing application data as date_unknown, never expired", () => {
    const state = classifyApplicationState({ application: undefined }, REF_DATE);
    expect(state).toBe("date_unknown");
  });

  it("classifies a malformed (unparseable) end date as date_unknown, never expired", () => {
    const state = classifyApplicationState(benefitWithWindow({ endDate: "not-a-date" }), REF_DATE);
    expect(state).toBe("date_unknown");
  });

  it("classifies an empty application object (no dates at all) as date_unknown", () => {
    const state = classifyApplicationState(benefitWithWindow({}), REF_DATE);
    expect(state).toBe("date_unknown");
  });
});

describe("classifyCatalog", () => {
  it("splits a mixed catalog into all four buckets correctly", () => {
    const benefits: Benefit[] = [
      { id: "expired-1", title: "t", shortDescription: "d", category: "welfare", source: { type: "government", organization: "o" }, benefitType: "other", application: { endDate: "2020-01-01" } },
      { id: "active-1", title: "t", shortDescription: "d", category: "welfare", source: { type: "government", organization: "o" }, benefitType: "other", application: { endDate: "2027-01-01" } },
      { id: "upcoming-1", title: "t", shortDescription: "d", category: "welfare", source: { type: "government", organization: "o" }, benefitType: "other", application: { startDate: "2027-01-01" } },
      { id: "unknown-1", title: "t", shortDescription: "d", category: "welfare", source: { type: "government", organization: "o" }, benefitType: "other" },
    ];

    const classified = classifyCatalog(benefits, REF_DATE);
    expect(classified.expired.map((b) => b.id)).toEqual(["expired-1"]);
    expect(classified.active.map((b) => b.id)).toEqual(["active-1"]);
    expect(classified.upcoming.map((b) => b.id)).toEqual(["upcoming-1"]);
    expect(classified.dateUnknown.map((b) => b.id)).toEqual(["unknown-1"]);
  });

  it("never drops or duplicates a record across buckets", () => {
    const benefits: Benefit[] = Array.from({ length: 20 }, (_, i) => ({
      id: `b-${i}`,
      title: "t",
      shortDescription: "d",
      category: "welfare",
      source: { type: "government", organization: "o" },
      benefitType: "other",
      application:
        i % 4 === 0
          ? { endDate: "2020-01-01" } // expired
          : i % 4 === 1
            ? { endDate: "2027-01-01" } // active
            : i % 4 === 2
              ? { startDate: "2027-01-01" } // upcoming
              : undefined, // date_unknown
    }));

    const classified = classifyCatalog(benefits, REF_DATE);
    const total =
      classified.expired.length + classified.active.length + classified.upcoming.length + classified.dateUnknown.length;
    expect(total).toBe(benefits.length);

    const allIds = new Set(
      [...classified.expired, ...classified.active, ...classified.upcoming, ...classified.dateUnknown].map((b) => b.id)
    );
    expect(allIds.size).toBe(benefits.length); // no duplicates
  });
});
