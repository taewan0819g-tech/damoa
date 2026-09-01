import { describe, expect, it } from "vitest";
import {
  atLeast,
  atMost,
  compareRangeToInterval,
  compareValueToInterval,
  intervalFromBoundaryWord,
  isInterval,
  lessThan,
  moreThan,
} from "@/lib/eligibility/interval";

/**
 * Section 6/25 of the constraint-compatibility spec: 이상(>=)/초과(>) and
 * 이하(<=)/미만(<) must never collapse into the same closed interval. These
 * tests hard-code the spec's own worked example: a user whose income is
 * EXACTLY 35,000,000원 must FAIL a "35,000,000원 미만" policy but PASS a
 * "35,000,000원 이하" policy — same boundary number, opposite outcome,
 * decided entirely by inclusivity.
 */
describe("interval boundary compatibility", () => {
  describe("compareValueToInterval (exact scalar, always pass/fail)", () => {
    it("이상 (>=, inclusive): a value exactly on the boundary passes", () => {
      expect(compareValueToInterval(35_000_000, atLeast(35_000_000))).toBe("pass");
    });

    it("초과 (>, strict): a value exactly on the boundary fails", () => {
      expect(compareValueToInterval(35_000_000, moreThan(35_000_000))).toBe("fail");
    });

    it("이하 (<=, inclusive): a value exactly on the boundary passes", () => {
      expect(compareValueToInterval(35_000_000, atMost(35_000_000))).toBe("pass");
    });

    it("미만 (<, strict): a value exactly on the boundary fails", () => {
      expect(compareValueToInterval(35_000_000, lessThan(35_000_000))).toBe("fail");
    });

    it("초과 and 이상 diverge only exactly at the boundary, not elsewhere", () => {
      expect(compareValueToInterval(35_000_001, moreThan(35_000_000))).toBe("pass");
      expect(compareValueToInterval(34_999_999, atLeast(35_000_000))).toBe("fail");
    });

    it("intervalFromBoundaryWord produces the same pass/fail split as the direct constructors", () => {
      expect(compareValueToInterval(35_000_000, intervalFromBoundaryWord("미만", 35_000_000))).toBe("fail");
      expect(compareValueToInterval(35_000_000, intervalFromBoundaryWord("이하", 35_000_000))).toBe("pass");
      expect(compareValueToInterval(35_000_000, intervalFromBoundaryWord("이상", 35_000_000))).toBe("pass");
      expect(compareValueToInterval(35_000_000, intervalFromBoundaryWord("초과", 35_000_000))).toBe("fail");
    });
  });

  describe("compareRangeToInterval (income-band-style range vs policy interval)", () => {
    it("passes when the user's whole range sits strictly inside an inclusive interval", () => {
      const result = compareRangeToInterval({ min: 20_000_000, max: 30_000_000 }, atMost(35_000_000));
      expect(result).toBe("pass");
    });

    it("fails when the user's whole range sits outside a strict upper bound", () => {
      const result = compareRangeToInterval({ min: 40_000_000, max: 50_000_000 }, lessThan(35_000_000));
      expect(result).toBe("fail");
    });

    it("resolves to unknown when the user's range straddles a strict boundary, even though a degenerate exact value wouldn't", () => {
      // The whole band [30M, 40M] straddles the 35M 미만 cutoff — some real
      // incomes in that band would pass, some would fail, so this must never
      // be forced to either pass or fail.
      const result = compareRangeToInterval({ min: 30_000_000, max: 40_000_000 }, lessThan(35_000_000));
      expect(result).toBe("unknown");
    });

    it("a degenerate range {min:x,max:x} (an exact known value) behaves exactly like compareValueToInterval", () => {
      const exact = { min: 35_000_000, max: 35_000_000 };
      expect(compareRangeToInterval(exact, lessThan(35_000_000))).toBe("fail");
      expect(compareRangeToInterval(exact, atMost(35_000_000))).toBe("pass");
    });

    it("passes for an open-ended (min-only) interval when the whole range is above the floor", () => {
      const result = compareRangeToInterval({ min: 40_000_000, max: Number.POSITIVE_INFINITY }, atLeast(35_000_000));
      expect(result).toBe("pass");
    });

    it("fails for an open-ended (min-only) interval when the whole range is strictly below a strict floor", () => {
      const result = compareRangeToInterval({ min: 0, max: 34_000_000 }, moreThan(35_000_000));
      expect(result).toBe("fail");
    });
  });

  describe("isInterval", () => {
    it("identifies a well-formed Interval object", () => {
      expect(isInterval(atLeast(1))).toBe(true);
    });

    it("rejects a legacy [min, max] tuple (the old range_within shape)", () => {
      expect(isInterval([0, 100])).toBe(false);
    });

    it("rejects a plain scalar", () => {
      expect(isInterval(35_000_000)).toBe(false);
    });
  });
});
