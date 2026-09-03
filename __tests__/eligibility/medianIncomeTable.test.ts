import { describe, expect, it } from "vitest";
import {
  MEDIAN_INCOME_TABLE,
  getMedianIncomeMonthlyAmount,
  resolvePolicyCurrentMedianIncomeYear,
} from "@/domain/medianIncome/table";

describe("MEDIAN_INCOME_TABLE data integrity", () => {
  it("every verified year has all 7 household sizes populated and a consistent eightPlusFormula", () => {
    for (const entry of MEDIAN_INCOME_TABLE) {
      if (entry.status !== "verified") continue;
      for (let size = 1; size <= 7; size++) {
        expect(entry.householdValues[size as 1 | 2 | 3 | 4 | 5 | 6 | 7]).toBeTypeOf("number");
      }
      expect(entry.eightPlusFormula).toBeDefined();
      expect(entry.eightPlusFormula?.perPersonIncrementKrw).toBe(
        (entry.householdValues[7] as number) - (entry.householdValues[6] as number)
      );
    }
  });

  it("2027 entry is explicitly partial with 7-person figure and eightPlusFormula left undefined (never derived from the 6.70% headline rate)", () => {
    const y2027 = MEDIAN_INCOME_TABLE.find((e) => e.year === 2027);
    expect(y2027?.status).toBe("partial");
    expect(y2027?.householdValues[7]).toBeUndefined();
    expect(y2027?.eightPlusFormula).toBeUndefined();
    for (let size = 1; size <= 6; size++) {
      expect(y2027?.householdValues[size as 1 | 2 | 3 | 4 | 5 | 6]).toBeTypeOf("number");
    }
  });
});

describe("resolvePolicyCurrentMedianIncomeYear", () => {
  it("resolves the latest table year whose effectiveFrom is on/before the given policy date", () => {
    expect(resolvePolicyCurrentMedianIncomeYear("2026-06-15")).toBe(2026);
    expect(resolvePolicyCurrentMedianIncomeYear("2026-01-01")).toBe(2026);
    expect(resolvePolicyCurrentMedianIncomeYear("2025-12-31")).toBe(2025);
    expect(resolvePolicyCurrentMedianIncomeYear("2027-01-01")).toBe(2027);
    expect(resolvePolicyCurrentMedianIncomeYear("2027-12-31")).toBe(2027);
  });

  it("returns undefined for a date before every table entry", () => {
    expect(resolvePolicyCurrentMedianIncomeYear("2020-12-31")).toBeUndefined();
  });
});

describe("getMedianIncomeMonthlyAmount", () => {
  it("returns the direct table figure for household sizes 1-7 in a verified year", () => {
    expect(getMedianIncomeMonthlyAmount(2026, 1)).toBe(2564238);
    expect(getMedianIncomeMonthlyAmount(2026, 4)).toBe(6494738);
    expect(getMedianIncomeMonthlyAmount(2026, 7)).toBe(9515150);
  });

  it("computes 8+ household sizes via the per-person increment when the formula is verified", () => {
    const perPerson = 9515150 - 8555952;
    expect(getMedianIncomeMonthlyAmount(2026, 8)).toBe(9515150 + perPerson);
    expect(getMedianIncomeMonthlyAmount(2026, 9)).toBe(9515150 + perPerson * 2);
  });

  it("returns undefined for an unverified household size in a partial year (2027, size 7 and 8+)", () => {
    expect(getMedianIncomeMonthlyAmount(2027, 7)).toBeUndefined();
    expect(getMedianIncomeMonthlyAmount(2027, 8)).toBeUndefined();
  });

  it("returns the verified figure for a populated size in the partial 2027 year", () => {
    expect(getMedianIncomeMonthlyAmount(2027, 1)).toBe(2736042);
    expect(getMedianIncomeMonthlyAmount(2027, 6)).toBe(9129201);
  });

  it("returns undefined for a year not in the table", () => {
    expect(getMedianIncomeMonthlyAmount(2019, 4)).toBeUndefined();
    expect(getMedianIncomeMonthlyAmount(2030, 4)).toBeUndefined();
  });

  it("returns undefined for invalid household sizes (0, negative, non-integer)", () => {
    expect(getMedianIncomeMonthlyAmount(2026, 0)).toBeUndefined();
    expect(getMedianIncomeMonthlyAmount(2026, -1)).toBeUndefined();
    expect(getMedianIncomeMonthlyAmount(2026, 3.5)).toBeUndefined();
  });
});
