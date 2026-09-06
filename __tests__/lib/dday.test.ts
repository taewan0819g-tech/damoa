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

  /**
   * Regression coverage for the SECOND deadline-comparator bug (found via
   * independent PR review after the NaN fix above landed): the first fix
   * only ever treated `kind === "upcoming"` as a comparable deadline, so a
   * benefit due TODAY (`kind: "today"`, D-0) silently fell into the same
   * "unknown" bucket as a missing/malformed/closed date instead of ranking
   * strictly ahead of it. `resolveComparableDays` now maps `"today"` -> `0`,
   * distinct from `undefined`, fixing exactly this.
   */
  describe("today (D-0) handling", () => {
    it("today vs D-1 (upcoming): today sorts first", () => {
      const today = "2026-09-06"; // D-0 relative to REF
      const dPlus1 = "2026-09-07"; // D-1
      expect(compareDeadlineProximity(today, dPlus1, REF)).toBeLessThan(0);
      expect(compareDeadlineProximity(dPlus1, today, REF)).toBeGreaterThan(0);
    });

    it("today vs missing (undefined): today sorts first", () => {
      const today = "2026-09-06";
      expect(compareDeadlineProximity(today, undefined, REF)).toBeLessThan(0);
      expect(compareDeadlineProximity(undefined, today, REF)).toBeGreaterThan(0);
    });

    it("today vs today: ties at exactly 0", () => {
      const today = "2026-09-06";
      const result = compareDeadlineProximity(today, today, REF);
      expect(result).toBe(0);
      expect(Number.isNaN(result)).toBe(false);
    });
  });

  it("D-1 (upcoming) vs missing (undefined): the upcoming one sorts first", () => {
    const dPlus1 = "2026-09-07"; // D-1
    expect(compareDeadlineProximity(dPlus1, undefined, REF)).toBeLessThan(0);
    expect(compareDeadlineProximity(undefined, dPlus1, REF)).toBeGreaterThan(0);
  });

  it("missing vs missing (both undefined): ties at exactly 0", () => {
    const result = compareDeadlineProximity(undefined, undefined, REF);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("malformed vs missing: ties at exactly 0, never NaN", () => {
    const resultA = compareDeadlineProximity("not-a-date", undefined, REF);
    const resultB = compareDeadlineProximity(undefined, "not-a-date", REF);
    expect(resultA).toBe(0);
    expect(resultB).toBe(0);
    expect(Number.isNaN(resultA)).toBe(false);
    expect(Number.isNaN(resultB)).toBe(false);
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
    // Includes "2026-09-06" (today relative to REF, kind "today") and
    // "2026-09-07" (D-1, kind "upcoming") alongside closed/malformed/missing
    // dates, so this sweep exercises every DDayInfo kind pairwise.
    const candidates = [undefined, "not-a-date", "2020-01-01", "2026-09-06", "2026-09-07", "2026-12-31"];
    for (const a of candidates) {
      for (const b of candidates) {
        expect(Number.isNaN(compareDeadlineProximity(a, b, REF))).toBe(false);
      }
    }
  });
});
