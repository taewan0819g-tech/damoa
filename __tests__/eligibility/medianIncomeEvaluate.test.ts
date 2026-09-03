import { describe, expect, it } from "vitest";
import {
  compareHouseholdIncomeToMedianIncomeThreshold,
  type MedianIncomeThresholdSpec,
} from "@/domain/medianIncome/evaluate";
import type { UserProfile } from "@/types/profile";

// 2026 table: 4인가구 monthly = 6,494,738 KRW (see domain/medianIncome/table.ts).
// 50% annual threshold = 6,494,738 * 0.5 * 12 = 38,968,428.
const THRESHOLD_50PCT_4PERSON_2026 = 38968428;

// A reference instant that resolves to policy year 2026 regardless of host
// timezone (mirrors marriageDuration.test.ts's explicit-UTC-offset convention).
const REF_2026 = new Date("2026-06-01T00:30:00+09:00");

const baseSpec: MedianIncomeThresholdSpec = {
  percent: 50,
  boundary: "lte",
  incomeMetric: "household_income",
  householdSizeMode: "scales_with_profile_household",
};

describe("compareHouseholdIncomeToMedianIncomeThreshold", () => {
  describe("boundary words at the exact threshold value", () => {
    const profileAt = (income: number): UserProfile => ({ householdSize: 4, annualHouseholdIncome: income });

    it('"이하" (lte): exactly at threshold -> pass (inclusive)', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026), spec, REF_2026)).toBe(
        "pass"
      );
    });

    it('"이하" (lte): 1 KRW over -> fail', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      expect(
        compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026 + 1), spec, REF_2026)
      ).toBe("fail");
    });

    it('"미만" (lt): exactly at threshold -> fail (strict)', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lt" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026), spec, REF_2026)).toBe(
        "fail"
      );
    });

    it('"미만" (lt): 1 KRW under -> pass', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lt" };
      expect(
        compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026 - 1), spec, REF_2026)
      ).toBe("pass");
    });

    it('"이상" (gte): exactly at threshold -> pass (inclusive)', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "gte" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026), spec, REF_2026)).toBe(
        "pass"
      );
    });

    it('"이상" (gte): 1 KRW under -> fail', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "gte" };
      expect(
        compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026 - 1), spec, REF_2026)
      ).toBe("fail");
    });

    it('"초과" (gt): exactly at threshold -> fail (strict)', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "gt" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026), spec, REF_2026)).toBe(
        "fail"
      );
    });

    it('"초과" (gt): 1 KRW over -> pass', () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "gt" };
      expect(
        compareHouseholdIncomeToMedianIncomeThreshold(profileAt(THRESHOLD_50PCT_4PERSON_2026 + 1), spec, REF_2026)
      ).toBe("pass");
    });
  });

  describe("householdSizeMode", () => {
    it("scales_with_profile_household uses profile.householdSize", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("pass");
    });

    it("scales_with_profile_household -> unknown when profile.householdSize is missing", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      const profile: UserProfile = { annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("unknown");
    });

    it("fixed_reference_household uses fixedHouseholdSize regardless of a DIFFERENT profile.householdSize", () => {
      const spec: MedianIncomeThresholdSpec = {
        ...baseSpec,
        boundary: "lte",
        householdSizeMode: "fixed_reference_household",
        fixedHouseholdSize: 4,
      };
      // profile.householdSize is 2 (would resolve to a different, lower
      // threshold) but the fixed reference size of 4 must govern instead.
      const profile: UserProfile = { householdSize: 2, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("pass");
    });

    it("fixed_reference_household -> unknown when fixedHouseholdSize is missing from the spec", () => {
      const spec: MedianIncomeThresholdSpec = {
        ...baseSpec,
        boundary: "lte",
        householdSizeMode: "fixed_reference_household",
      };
      const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("unknown");
    });
  });

  describe("year resolution", () => {
    it("uses spec.year when the clause named an explicit year, overriding the reference instant's policy year", () => {
      // spec pins 2025 even though REF_2026 would otherwise resolve to 2026.
      // 2025 4-person monthly = 6,097,773 -> 50% annual = 36,586,638 (exact threshold).
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte", year: 2025 };
      const atThreshold2025: UserProfile = { householdSize: 4, annualHouseholdIncome: 36586638 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(atThreshold2025, spec, REF_2026)).toBe("pass");

      // Same income against the (lower, since 2025 < 2026) 2025 threshold
      // plus 1 KRW must fail -- confirms the 2025 table, not 2026's, actually
      // governed the comparison.
      const overThreshold2025: UserProfile = { householdSize: 4, annualHouseholdIncome: 36586639 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(overThreshold2025, spec, REF_2026)).toBe("fail");
    });

    it("falls back to the policy-current year (via referenceInstant) when spec.year is omitted", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("pass");
    });

    it("unverified year+size combination (2027, 7-person, partial table) -> unknown, never guessed", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte", year: 2027 };
      const profile: UserProfile = { householdSize: 7, annualHouseholdIncome: 1 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("unknown");
    });

    it("a reference instant before every table entry -> unknown (no applicable year)", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: 1 };
      const ancientRef = new Date("2020-06-01T00:30:00+09:00");
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, ancientRef)).toBe("unknown");
    });
  });

  describe("missing/invalid income data -> unknown, never guessed", () => {
    it("no income band and no exact annualHouseholdIncome -> unknown", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      const profile: UserProfile = { householdSize: 4 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("unknown");
    });

    it("an income BAND that straddles the threshold -> unknown (can't prove which side the real value is on)", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      // 3000_4000 band -> {min: 30,000,000, max: 40,000,000}; threshold is
      // 38,968,428, which falls strictly inside that range, so we can't prove pass/fail.
      const profile: UserProfile = { householdSize: 4, householdIncomeBand: "3000_4000" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("unknown");
    });

    it("an income BAND fully below the threshold -> pass", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      // 2000_3000 band -> {min: 20,000,000, max: 30,000,000}, fully <= 38,968,428.
      const profile: UserProfile = { householdSize: 4, householdIncomeBand: "2000_3000" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("pass");
    });

    it("an income BAND fully above the threshold -> fail", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      // over_7000 band -> {min: 70,000,000, max: Infinity}, fully > 38,968,428.
      const profile: UserProfile = { householdSize: 4, householdIncomeBand: "over_7000" };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("fail");
    });

    it("invalid percent (<= 0) -> unknown", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte", percent: 0 };
      const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: 1 };
      expect(compareHouseholdIncomeToMedianIncomeThreshold(profile, spec, REF_2026)).toBe("unknown");
    });

    it("non-integer or zero/negative householdSize -> unknown", () => {
      const spec: MedianIncomeThresholdSpec = { ...baseSpec, boundary: "lte" };
      expect(
        compareHouseholdIncomeToMedianIncomeThreshold(
          { householdSize: 0, annualHouseholdIncome: 1 },
          spec,
          REF_2026
        )
      ).toBe("unknown");
      expect(
        compareHouseholdIncomeToMedianIncomeThreshold(
          { householdSize: -2, annualHouseholdIncome: 1 },
          spec,
          REF_2026
        )
      ).toBe("unknown");
    });
  });
});
