import { describe, expect, it } from "vitest";
import { parseMoisDeadline } from "@/lib/eligibility/extraction/moisDeadlineParser";

describe("parseMoisDeadline", () => {
  describe("parseable date ranges", () => {
    it("parses a dot-separated range with no trailing period", () => {
      expect(parseMoisDeadline("2025.04.01~2026.03.31")).toEqual({
        deadlineType: "date_range",
        startDate: "2025-04-01",
        endDate: "2026-03-31",
      });
    });

    it("parses a dot-separated range with trailing periods after each day (common MOIS format)", () => {
      expect(parseMoisDeadline("2026.2.2.~2026.11.30.")).toEqual({
        deadlineType: "date_range",
        startDate: "2026-02-02",
        endDate: "2026-11-30",
      });
    });

    it("parses a dash-separated range", () => {
      expect(parseMoisDeadline("2026-05-04 ~ 2026-05-20")).toEqual({
        deadlineType: "date_range",
        startDate: "2026-05-04",
        endDate: "2026-05-20",
      });
    });

    it("parses a 년/월/일 range", () => {
      expect(parseMoisDeadline("2026년 3월 1일 ~ 2026년 3월 31일")).toEqual({
        deadlineType: "date_range",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      });
    });

    it("extracts the first embedded range from surrounding free text", () => {
      const result = parseMoisDeadline("2026.10.01~2026.10.31 (담당부서 사정에 따라 변경될 수 있음)");
      expect(result).toEqual({ deadlineType: "date_range", startDate: "2026-10-01", endDate: "2026-10-31" });
    });
  });

  describe("never guesses invalid or out-of-order dates", () => {
    it("rejects an overflowed calendar date (e.g. Feb 30) instead of rolling it forward", () => {
      expect(parseMoisDeadline("2026.2.30~2026.3.31")).toEqual({ deadlineType: "unparsed" });
    });

    it("rejects a range where the end date is before the start date", () => {
      expect(parseMoisDeadline("2026.10.31~2026.10.01")).toEqual({ deadlineType: "unparsed" });
    });

    it("rejects an out-of-range month", () => {
      expect(parseMoisDeadline("2026.13.01~2026.13.15")).toEqual({ deadlineType: "unparsed" });
    });
  });

  describe("open-ended keywords", () => {
    it.each(["상시신청", "수시", "연중", "채용시", "채용 시 모집"])("classifies %s as open_ended with no dates", (text) => {
      expect(parseMoisDeadline(text)).toEqual({ deadlineType: "open_ended" });
    });
  });

  describe("budget-exhaustion keywords", () => {
    it.each(["예산 소진 시 조기 마감", "선착순 마감", "소진 시 종료"])(
      "classifies %s as budget_exhaustion with no dates",
      (text) => {
        expect(parseMoisDeadline(text)).toEqual({ deadlineType: "budget_exhaustion" });
      }
    );

    it("prefers a parseable date range over an accompanying budget-exhaustion caveat", () => {
      const result = parseMoisDeadline("2026.2.2.~2026.11.30. (예산 소진 시 발급 마감)");
      expect(result).toEqual({ deadlineType: "date_range", startDate: "2026-02-02", endDate: "2026-11-30" });
    });
  });

  describe("ambiguous free text stays unparsed (never guesses)", () => {
    it("leaves a relative deadline unparsed", () => {
      expect(parseMoisDeadline("대출 약정희망일의 전월 25일까지")).toEqual({ deadlineType: "unparsed" });
    });

    it("leaves a multi-window schedule unparsed", () => {
      const result = parseMoisDeadline(
        "○ 정기신청 : 5.1.~5.31.○ 반기신청 - 상반기분 신청 : 9.1.~9.15. - 하반기분 신청 : 3.1.~3.15."
      );
      expect(result.deadlineType).toBe("unparsed");
    });

    it("leaves a reference-to-external-rule deadline unparsed", () => {
      expect(parseMoisDeadline("주택도시기금 주거안정 월세대출 규정에 따름")).toEqual({ deadlineType: "unparsed" });
    });
  });

  describe("missing/malformed", () => {
    it("classifies undefined as unparsed", () => {
      expect(parseMoisDeadline(undefined)).toEqual({ deadlineType: "unparsed" });
    });

    it("classifies an empty/whitespace-only string as unparsed", () => {
      expect(parseMoisDeadline("   ")).toEqual({ deadlineType: "unparsed" });
    });
  });
});
