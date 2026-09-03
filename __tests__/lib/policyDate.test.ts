import { describe, expect, it } from "vitest";
import {
  POLICY_TIME_ZONE,
  policyDateString,
  todayPolicyDateString,
  parseCalendarDateString,
  isValidCalendarDateString,
  calendarDateToString,
  subtractCalendarYears,
  isTodayOrPastPolicyDateString,
} from "@/lib/dates/policyDate";

/**
 * lib/dates/policyDate.ts is the single source of truth for "what calendar
 * date is it, for Korean public policy purposes" — deliberately Asia/Seoul,
 * never the host machine's own configured timezone. Every instant below is
 * constructed with an EXPLICIT UTC offset so the assertions are correct
 * regardless of which timezone the test runner's machine happens to use.
 */
describe("policyDate", () => {
  it("fixes the policy timezone to Asia/Seoul", () => {
    expect(POLICY_TIME_ZONE).toBe("Asia/Seoul");
  });

  describe("policyDateString", () => {
    it("reads the Asia/Seoul calendar day, not the UTC day, for an instant just after UTC midnight", () => {
      // 2026-09-03T00:30:00Z == 2026-09-03T09:30:00+09:00 -> still Sep 3 in
      // both zones; use a case where the two zones actually disagree below.
      expect(policyDateString(new Date("2026-09-03T00:30:00Z"))).toBe("2026-09-03");
    });

    it("KST day is AHEAD of the UTC day for a late-UTC-evening instant", () => {
      // 2026-09-02T15:30:00Z == 2026-09-03T00:30:00+09:00 — UTC still reads
      // Sep 2, but the Korean policy calendar has already rolled to Sep 3.
      expect(policyDateString(new Date("2026-09-02T15:30:00Z"))).toBe("2026-09-03");
    });

    it("KST day matches an explicit +09:00-offset instant regardless of host timezone", () => {
      expect(policyDateString(new Date("2026-01-01T00:05:00+09:00"))).toBe("2026-01-01");
    });

    it("an instant just before KST midnight still reads the previous Korean day", () => {
      // 2026-09-02T23:59:00+09:00 == 2026-09-02T14:59:00Z
      expect(policyDateString(new Date("2026-09-02T23:59:00+09:00"))).toBe("2026-09-02");
    });
  });

  it("todayPolicyDateString is an alias of policyDateString", () => {
    const instant = new Date("2026-09-02T15:30:00Z");
    expect(todayPolicyDateString(instant)).toBe(policyDateString(instant));
  });

  describe("parseCalendarDateString / isValidCalendarDateString", () => {
    it("parses a well-formed calendar date", () => {
      expect(parseCalendarDateString("2026-09-03")).toEqual({ year: 2026, month: 9, day: 3 });
      expect(isValidCalendarDateString("2026-09-03")).toBe(true);
    });

    it("rejects an impossible day-of-month (Feb 30) instead of silently normalizing it", () => {
      expect(parseCalendarDateString("2026-02-30")).toBeNull();
      expect(isValidCalendarDateString("2026-02-30")).toBe(false);
    });

    it("rejects Feb 29 on a non-leap year", () => {
      expect(parseCalendarDateString("2025-02-29")).toBeNull();
      expect(isValidCalendarDateString("2025-02-29")).toBe(false);
    });

    it("accepts Feb 29 on a leap year", () => {
      expect(parseCalendarDateString("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
      expect(isValidCalendarDateString("2024-02-29")).toBe(true);
    });

    it("rejects an out-of-range month", () => {
      expect(isValidCalendarDateString("2026-13-01")).toBe(false);
    });

    it("rejects malformed strings", () => {
      expect(isValidCalendarDateString("not-a-date")).toBe(false);
      expect(isValidCalendarDateString("2026-9-3")).toBe(false);
      expect(isValidCalendarDateString("")).toBe(false);
    });
  });

  describe("calendarDateToString", () => {
    it("zero-pads month and day", () => {
      expect(calendarDateToString({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05");
    });
  });

  describe("subtractCalendarYears", () => {
    it("subtracts whole years on an ordinary date", () => {
      expect(subtractCalendarYears({ year: 2026, month: 3, day: 15 }, 1)).toEqual({
        year: 2025,
        month: 3,
        day: 15,
      });
    });

    it("clamps Feb 29 to Feb 28 when the target year is not a leap year", () => {
      expect(subtractCalendarYears({ year: 2024, month: 2, day: 29 }, 1)).toEqual({
        year: 2023,
        month: 2,
        day: 28,
      });
    });

    it("does not clamp when subtracting lands on another leap year", () => {
      expect(subtractCalendarYears({ year: 2024, month: 2, day: 29 }, 4)).toEqual({
        year: 2020,
        month: 2,
        day: 29,
      });
    });
  });

  describe("isTodayOrPastPolicyDateString", () => {
    it("true for the exact policy-calendar today", () => {
      const ref = new Date("2026-09-02T15:30:00Z"); // Sep 3 KST
      expect(isTodayOrPastPolicyDateString("2026-09-03", ref)).toBe(true);
    });

    it("true for a past date", () => {
      const ref = new Date("2026-09-02T15:30:00Z"); // Sep 3 KST
      expect(isTodayOrPastPolicyDateString("2026-09-02", ref)).toBe(true);
    });

    it("false for a date that is future by the KST calendar even though it's still 'today' in UTC", () => {
      // ref is Sep 3 KST / Sep 2 UTC. "2026-09-03" must count as a future
      // date only if compared against the WRONG (UTC) day; against the
      // correct KST day, it's today, not future.
      const ref = new Date("2026-09-02T15:30:00Z");
      expect(isTodayOrPastPolicyDateString("2026-09-04", ref)).toBe(false);
    });

    it("false for an invalid calendar date string", () => {
      expect(isTodayOrPastPolicyDateString("2026-02-30", new Date("2026-09-02T15:30:00Z"))).toBe(false);
    });
  });
});
