import { describe, expect, it } from "vitest";
import {
  compareMarriageDurationToThreshold,
  type MarriageDurationSpec,
} from "@/domain/profile/marriageDuration";

/**
 * Domain-level boundary tests for compareMarriageDurationToThreshold — the
 * EXACT calendar-date marriage-duration comparison introduced to replace an
 * earlier floored `differenceInYears` design (see the function's own doc
 * comment in domain/profile/marriageDuration.ts for why flooring is unsafe:
 * someone married 1 year 11 months ago has differenceInYears===1, which
 * would WRONGLY pass a "1년 이내" cutoff under the floored design).
 *
 * Every test injects an explicit `referenceDate` so the assertions are
 * deterministic and don't depend on the real wall-clock date.
 */
describe("compareMarriageDurationToThreshold", () => {
  // Constructed via local-time (year, monthIndex, day) rather than a
  // Z-suffixed ISO string: `compareMarriageDurationToThreshold` parses
  // `marriageDate` with date-fns `parseISO`, which interprets a bare
  // "YYYY-MM-DD" string as LOCAL midnight, not UTC midnight. Building the
  // reference date the same (local) way keeps both sides of every
  // comparison in the same calendar frame regardless of the machine's
  // timezone.
  const REF = new Date(2026, 2, 15); // 2026-03-15, local midnight

  describe('"이내"/"이하" (duration <= N) -> marriageDate >= cutoff, inclusive', () => {
    const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };

    it("exactly 1 year ago (on the cutoff date) -> pass (inclusive)", () => {
      expect(compareMarriageDurationToThreshold("2025-03-15", spec, REF)).toBe("pass");
    });

    it("1 year minus 1 day ago (just inside the window) -> pass", () => {
      expect(compareMarriageDurationToThreshold("2025-03-16", spec, REF)).toBe("pass");
    });

    it("1 year plus 1 day ago (just outside the window) -> fail", () => {
      expect(compareMarriageDurationToThreshold("2025-03-14", spec, REF)).toBe("fail");
    });
  });

  describe('"미만" (duration < N) -> marriageDate > cutoff, strict', () => {
    const spec: MarriageDurationSpec = { years: 1, boundary: "lt" };

    it("exactly 1 year ago (on the cutoff date) -> fail (strict boundary excludes the exact cutoff)", () => {
      expect(compareMarriageDurationToThreshold("2025-03-15", spec, REF)).toBe("fail");
    });

    it("1 year minus 1 day ago (just inside) -> pass", () => {
      expect(compareMarriageDurationToThreshold("2025-03-16", spec, REF)).toBe("pass");
    });

    it("1 year plus 1 day ago (outside) -> fail", () => {
      expect(compareMarriageDurationToThreshold("2025-03-14", spec, REF)).toBe("fail");
    });
  });

  describe('"이상" (duration >= N) -> marriageDate <= cutoff, inclusive', () => {
    const spec: MarriageDurationSpec = { years: 1, boundary: "gte" };

    it("exactly 1 year ago (on the cutoff date) -> pass (inclusive)", () => {
      expect(compareMarriageDurationToThreshold("2025-03-15", spec, REF)).toBe("pass");
    });

    it("1 year minus 1 day ago (married more recently than the cutoff) -> fail", () => {
      expect(compareMarriageDurationToThreshold("2025-03-16", spec, REF)).toBe("fail");
    });

    it("1 year plus 1 day ago (married before the cutoff) -> pass", () => {
      expect(compareMarriageDurationToThreshold("2025-03-14", spec, REF)).toBe("pass");
    });
  });

  describe('"초과" (duration > N) -> marriageDate < cutoff, strict', () => {
    const spec: MarriageDurationSpec = { years: 1, boundary: "gt" };

    it("exactly 1 year ago (on the cutoff date) -> fail (strict boundary excludes the exact cutoff)", () => {
      expect(compareMarriageDurationToThreshold("2025-03-15", spec, REF)).toBe("fail");
    });

    it("1 year plus 1 day ago (married before the cutoff) -> pass", () => {
      expect(compareMarriageDurationToThreshold("2025-03-14", spec, REF)).toBe("pass");
    });
  });

  describe("the core bug fix: 1 year 11 months ago must FAIL a '1년 이내' cutoff", () => {
    it('married 2024-04-15 vs reference 2026-03-15 (1yr 11mo elapsed, floored differenceInYears===1) -> fail under exact-calendar "이내"', () => {
      // A floored differenceInYears(REF, "2024-04-15") === 1 (less than 2
      // full years elapsed) would have WRONGLY PASSED a naive "<= 1" check
      // built on that floored integer. The exact cutoff is subYears(REF, 1)
      // = 2025-03-15; "2024-04-15" is BEFORE that cutoff (more than 1 exact
      // year has actually elapsed), so the real, unfloored comparison must
      // fail — this is exactly the real-world misclassification the
      // exact-calendar design fixes.
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      expect(compareMarriageDurationToThreshold("2024-04-15", spec, REF)).toBe("fail");
    });
  });

  describe("leap-year boundary", () => {
    it("subtracting 1 year from a leap-year Feb 29 reference lands on Feb 28 (non-leap) -> exact cutoff comparison still correct", () => {
      const leapRef = new Date(2024, 1, 29); // 2024-02-29, local midnight
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      // cutoff = subYears(2024-02-29, 1) = 2023-02-28 (date-fns clamps to the
      // last valid day of Feb in the non-leap target year).
      expect(compareMarriageDurationToThreshold("2023-02-28", spec, leapRef)).toBe("pass");
      expect(compareMarriageDurationToThreshold("2023-02-27", spec, leapRef)).toBe("fail");
    });

    it("marriageDate itself on a leap day (2024-02-29) compares correctly against a non-leap-year reference", () => {
      const ref = new Date(2025, 2, 1); // 2025-03-01, local midnight
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      // cutoff = subYears(2025-03-01, 1) = 2024-03-01; marriageDate
      // 2024-02-29 is before that cutoff, so the "within 1 year" window
      // (marriageDate >= cutoff) is NOT satisfied.
      expect(compareMarriageDurationToThreshold("2024-02-29", spec, ref)).toBe("fail");
    });
  });

  describe("date-only vs time-of-day boundary (checkpoint-3 fix)", () => {
    // Mirrors the exact scenario in the function's own doc comment: evaluating
    // late in the day must NOT shift the cutoff within the current calendar
    // day. Reference is 2026-09-02 20:30 LOCAL (deliberately non-midnight).
    const REF_EVENING = new Date(2026, 8, 2, 20, 30); // 2026-09-02T20:30 local

    it('marriageDate exactly 1 calendar year before a non-midnight reference -> PASS under "이내" (inclusive)', () => {
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      // Without startOfDay normalization, cutoff would be 2025-09-02T20:30,
      // which is AFTER parsed (2025-09-02T00:00), wrongly failing this case.
      expect(compareMarriageDurationToThreshold("2025-09-02", spec, REF_EVENING)).toBe("pass");
    });

    it('the same exact-1-year boundary FAILS under "미만" (strict) with a non-midnight reference', () => {
      const spec: MarriageDurationSpec = { years: 1, boundary: "lt" };
      expect(compareMarriageDurationToThreshold("2025-09-02", spec, REF_EVENING)).toBe("fail");
    });

    it("marriageDate one day inside the window (2025-09-03) -> PASS for 1년 이내, non-midnight reference", () => {
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      expect(compareMarriageDurationToThreshold("2025-09-03", spec, REF_EVENING)).toBe("pass");
    });

    it("marriageDate one day outside the window (2025-09-01) -> FAIL for 1년 이내, non-midnight reference", () => {
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      expect(compareMarriageDurationToThreshold("2025-09-01", spec, REF_EVENING)).toBe("fail");
    });

    it("leap-year cutoff still resolves correctly when the reference carries a non-midnight time", () => {
      // Reference: 2024-02-29 (leap day) at 23:45 local. cutoff = subYears of
      // the DAY-NORMALIZED reference (2024-02-29T00:00) by 1 year, which
      // date-fns clamps to 2023-02-28 (non-leap year has no Feb 29).
      const leapRefEvening = new Date(2024, 1, 29, 23, 45);
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      expect(compareMarriageDurationToThreshold("2023-02-28", spec, leapRefEvening)).toBe("pass");
      expect(compareMarriageDurationToThreshold("2023-02-27", spec, leapRefEvening)).toBe("fail");
    });

    it("a future marriageDate (later the same day as a non-midnight reference) still resolves to unknown, not a guessed pass/fail", () => {
      const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };
      // marriageDate "2026-09-03" is calendar-after REF_EVENING's day
      // (2026-09-02), even though REF_EVENING's raw Date timestamp (20:30)
      // is later in the day than 2026-09-03T00:00 would be on its own day —
      // day-level comparison is what must govern here.
      expect(compareMarriageDurationToThreshold("2026-09-03", spec, REF_EVENING)).toBe("unknown");
    });
  });

  describe("missing/invalid/future marriageDate -> unknown, never fail", () => {
    const spec: MarriageDurationSpec = { years: 1, boundary: "lte" };

    it("undefined marriageDate -> unknown", () => {
      expect(compareMarriageDurationToThreshold(undefined, spec, REF)).toBe("unknown");
    });

    it("empty-string marriageDate -> unknown", () => {
      expect(compareMarriageDurationToThreshold("", spec, REF)).toBe("unknown");
    });

    it("malformed/invalid marriageDate string -> unknown", () => {
      expect(compareMarriageDurationToThreshold("not-a-date", spec, REF)).toBe("unknown");
    });

    it("future marriageDate (after the reference date) -> unknown, not a guessed pass/fail", () => {
      expect(compareMarriageDurationToThreshold("2026-06-01", spec, REF)).toBe("unknown");
    });
  });
});
