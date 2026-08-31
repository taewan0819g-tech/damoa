import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "@/lib/eligibility/ruleEngine";
import type { EligibilityRuleGroup } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Income RANGE matching: the user only ever reports an income BAND (e.g.
 * "2,000~3,000만원"), never an exact figure, so eligibility against a
 * policy's income threshold has to compare range vs range rather than
 * number vs range. A user range fully inside the policy's allowed range is
 * a safe pass; a range with no overlap at all is a safe fail; a range that
 * only partially overlaps means we can't tell whether the user's real
 * number is on the eligible side, so it must resolve to unknown rather
 * than guessing either way.
 */
function rangeRule(value: [number, number]): EligibilityRuleGroup {
  return {
    type: "all",
    rules: [{ id: "income", field: "individualIncomeRange", operator: "range_within", value, required: true }],
  };
}

describe("income range matching", () => {
  it("passes when the user's income band is fully contained within the policy's range", () => {
    const profile: UserProfile = { individualIncomeBand: "2000_3000" }; // {min:20M, max:30M}
    const status = evaluateEligibility({ eligibility: rangeRule([10_000_000, 50_000_000]) }, profile);
    expect(status).toBe("likely_eligible");
  });

  it("resolves to unknown when the user's band only partially overlaps the policy's range", () => {
    const profile: UserProfile = { individualIncomeBand: "2000_3000" }; // {min:20M, max:30M}
    const status = evaluateEligibility({ eligibility: rangeRule([0, 25_000_000]) }, profile);
    expect(status).toBe("unknown");
  });

  it("fails when the user's band has no overlap at all with the policy's range", () => {
    const profile: UserProfile = { individualIncomeBand: "3000_4000" }; // {min:30M, max:40M}
    const status = evaluateEligibility({ eligibility: rangeRule([0, 10_000_000]) }, profile);
    expect(status).toBe("not_eligible");
  });

  it("passes for an open-ended (min-only) policy range when the user's band is entirely above the floor", () => {
    const profile: UserProfile = { individualIncomeBand: "over_7000" }; // {min:70M, max:Infinity}
    const status = evaluateEligibility(
      { eligibility: rangeRule([50_000_000, Number.POSITIVE_INFINITY]) },
      profile
    );
    expect(status).toBe("likely_eligible");
  });

  it("resolves to unknown for an open-ended (min-only) policy range when the user's band straddles the floor", () => {
    const profile: UserProfile = { individualIncomeBand: "under_1000" }; // {min:0, max:10M}
    const status = evaluateEligibility(
      { eligibility: rangeRule([5_000_000, Number.POSITIVE_INFINITY]) },
      profile
    );
    expect(status).toBe("unknown");
  });

  it("never treats the 'I don't know' income band as a numeric range", () => {
    const profile: UserProfile = { individualIncomeBand: "unknown" };
    const status = evaluateEligibility({ eligibility: rangeRule([0, 30_000_000]) }, profile);
    expect(status).toBe("unknown");
  });

  it("falls back to the legacy exact-income scalar as a degenerate range when no band is set", () => {
    const profile: UserProfile = { annualIndividualIncome: 25_000_000 };
    const status = evaluateEligibility({ eligibility: rangeRule([10_000_000, 50_000_000]) }, profile);
    expect(status).toBe("likely_eligible");
  });
});
