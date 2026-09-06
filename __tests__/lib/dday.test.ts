import { describe, expect, it } from "vitest";
import { compareDeadlineProximity } from "@/lib/dates/dday";

/**
 * Regression coverage for the D-day comparator NaN bug found by the
 * 2026-09-06 real-profile Home audit: comparing two benefits that BOTH lack
 * a resolvable upcoming deadline (`date_unknown`, malformed, or already
 * closed) used to compute `Infinity - Infinity === NaN`. Callers checked
 * `if (ddayDiff !== 0) return ddayDiff`, and `NaN !== 0` is `true`, so the
 * comparator returned `NaN` instead of falling through to the documented
 * final benefit-id tiebreak. `Array.prototype.sort` treats a `NaN`
 * comparator result as "keep relative (pre-sort) order" — silently
 * replacing the deterministic id ordering with incidental array order,
 * which matters a great deal given ~94% of the real catalog is
 * `date_unknown`.
 */
const REF = new Date("2026-09-06T00:00:00+09:00");

describe("compareDeadlineProximity", () => {
  it("finite vs finite: nearer deadline sorts first", () => {
    const sooner = "2026-09-10"; // D-4
    const later = "2026-10-01"; // D-25
    expect(compareDeadlineProximity(sooner, later, REF)).toBeLessThan(0);
    expect(compareDeadlineProximity(later, sooner, REF)).toBeGreaterThan(0);
  });

  it("finite vs unknown (undefined): the finite one sorts first", () => {
    expect(compareDeadlineProximity("2026-09-10", undefined, REF)).toBeLessThan(0);
    expect(compareDeadlineProximity(undefined, "2026-09-10", REF)).toBeGreaterThan(0);
  });

  it("finite vs unknown (malformed date string): the finite one sorts first", () => {
    expect(compareDeadlineProximity("2026-09-10", "not-a-date", REF)).toBeLessThan(0);
    expect(compareDeadlineProximity("not-a-date", "2026-09-10", REF)).toBeGreaterThan(0);
  });

  it("finite vs unknown (already-closed date): the finite/upcoming one sorts first", () => {
    // getDDayInfo classifies a past date as "closed", not "upcoming" — same
    // bucket as date_unknown for this comparator's purposes (unchanged from
    // prior Infinity-based behavior).
    expect(compareDeadlineProximity("2026-09-10", "2020-01-01", REF)).toBeLessThan(0);
  });

  it("unknown vs unknown (both undefined): ties at exactly 0, never NaN", () => {
    const result = compareDeadlineProximity(undefined, undefined, REF);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("unknown vs unknown (both malformed/missing in any combination): ties at exactly 0, never NaN", () => {
    for (const [a, b] of [
      [undefined, undefined],
      [undefined, "not-a-date"],
      ["not-a-date", undefined],
      ["not-a-date", "also-not-a-date"],
      ["2020-01-01", "2019-01-01"], // both already closed -> both non-"upcoming"
    ] as const) {
      const result = compareDeadlineProximity(a, b, REF);
      expect(result).toBe(0);
      expect(Number.isNaN(result)).toBe(false);
    }
  });

  it("never returns NaN for any finite/unknown combination", () => {
    const candidates = [undefined, "not-a-date", "2020-01-01", "2026-09-06", "2026-12-31"];
    for (const a of candidates) {
      for (const b of candidates) {
        expect(Number.isNaN(compareDeadlineProximity(a, b, REF))).toBe(false);
      }
    }
  });
});
