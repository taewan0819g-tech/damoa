import { describe, expect, it } from "vitest";
import {
  localDateStringFromDate,
  todayLocalDateString,
  isValidCalendarDateString,
  isTodayOrPastLocalDateString,
} from "@/lib/dates/localDate";

/**
 * Part 5 (date-only UI/validation consistency): `new Date().toISOString().slice(0, 10)`
 * converts to UTC before slicing, which reports YESTERDAY's date during the
 * first ~9 hours of any KST calendar day (UTC+9). This test environment's
 * own system timezone is Asia/Seoul (confirmed via
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`), so a `Date`
 * constructed via the LOCAL multi-arg constructor genuinely differs from its
 * own `toISOString()` UTC slice near local midnight — letting this test
 * demonstrate the real bug (not just assert an implementation detail).
 */
describe("localDate", () => {
  describe("localDateStringFromDate / todayLocalDateString: LOCAL calendar day, never UTC-shifted", () => {
    it("at 02:00 local time, reports the LOCAL calendar day even though toISOString() (UTC) would report the previous day", () => {
      // 2026-09-02 02:00 in the local (Asia/Seoul, UTC+9) timezone.
      const earlyMorningLocal = new Date(2026, 8, 2, 2, 0, 0);

      // The exact bug this module fixes: UTC-slicing reports "2026-09-01" here.
      expect(earlyMorningLocal.toISOString().slice(0, 10)).toBe("2026-09-01");

      // The fix: local-calendar accessors correctly report "2026-09-02".
      expect(localDateStringFromDate(earlyMorningLocal)).toBe("2026-09-02");
      expect(todayLocalDateString(earlyMorningLocal)).toBe("2026-09-02");
    });

    it("pads single-digit month/day with a leading zero", () => {
      expect(localDateStringFromDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });

    it("away from any boundary, matches the plain local Y-M-D", () => {
      const noon = new Date(2026, 5, 15, 12, 0, 0);
      expect(localDateStringFromDate(noon)).toBe("2026-06-15");
    });
  });

  describe("isValidCalendarDateString: rejects impossible dates instead of letting Date auto-normalize them", () => {
    it("accepts a normal valid date", () => {
      expect(isValidCalendarDateString("2026-09-02")).toBe(true);
    });

    it("rejects malformed input", () => {
      expect(isValidCalendarDateString("not-a-date")).toBe(false);
      expect(isValidCalendarDateString("2026-9-2")).toBe(false);
      expect(isValidCalendarDateString("")).toBe(false);
    });

    it('rejects "2026-02-30" (JS Date would silently normalize this to March 2)', () => {
      expect(new Date(2026, 1, 30).getMonth()).toBe(2); // sanity check: Date DOES auto-normalize
      expect(isValidCalendarDateString("2026-02-30")).toBe(false);
    });

    it("rejects an out-of-range month", () => {
      expect(isValidCalendarDateString("2026-13-01")).toBe(false);
      expect(isValidCalendarDateString("2026-00-01")).toBe(false);
    });

    it("accepts a leap day only in a leap year", () => {
      expect(isValidCalendarDateString("2024-02-29")).toBe(true); // 2024 is a leap year
      expect(isValidCalendarDateString("2025-02-29")).toBe(false); // 2025 is not
    });
  });

  describe("isTodayOrPastLocalDateString", () => {
    const referenceDate = new Date(2026, 8, 2, 12, 0, 0); // "today" = 2026-09-02, local noon

    it("accepts today", () => {
      expect(isTodayOrPastLocalDateString("2026-09-02", referenceDate)).toBe(true);
    });

    it("accepts a past date", () => {
      expect(isTodayOrPastLocalDateString("2020-01-01", referenceDate)).toBe(true);
    });

    it("rejects tomorrow", () => {
      expect(isTodayOrPastLocalDateString("2026-09-03", referenceDate)).toBe(false);
    });

    it("rejects an invalid calendar date even if it would lexicographically sort as past", () => {
      expect(isTodayOrPastLocalDateString("2026-02-30", referenceDate)).toBe(false);
    });

    it("still correctly accepts 'today' near a UTC day-boundary hour (02:00 local)", () => {
      const earlyMorningReference = new Date(2026, 8, 2, 2, 0, 0);
      expect(isTodayOrPastLocalDateString("2026-09-02", earlyMorningReference)).toBe(true);
    });
  });
});
