import type { Benefit, BenefitMatchResult, EligibilityStatus, UserProfile } from "@/types";
import { evaluateEligibility, evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";

export function matchBenefits(benefits: Benefit[], profile: UserProfile): BenefitMatchResult[] {
  return benefits.map((benefit) => ({
    benefitId: benefit.id,
    status: evaluateEligibility(benefit, profile),
  }));
}

export function matchBenefit(benefit: Benefit, profile: UserProfile): BenefitMatchResult {
  return { benefitId: benefit.id, status: evaluateEligibility(benefit, profile) };
}

export interface BenefitMatchDetailedResult extends BenefitMatchResult {
  /** True when at least one rule was actually checked against real profile data. */
  hasEvidence: boolean;
}

/**
 * Like `matchBenefits`, but also surfaces per-benefit evidence diagnostics
 * from `evaluateEligibilityDetailed`. Used to build a personalized default
 * feed that can tell an "unknown" backed by real matched criteria (worth
 * showing) apart from an "unknown" that's just an absence of any data
 * (not worth showing as if it were personalized) — see `isRelevantForFeed`.
 */
export function matchBenefitsDetailed(benefits: Benefit[], profile: UserProfile): BenefitMatchDetailedResult[] {
  return benefits.map((benefit) => {
    const diag = evaluateEligibilityDetailed(benefit, profile);
    return { benefitId: benefit.id, status: diag.status, hasEvidence: diag.hasEvidence };
  });
}

/**
 * Whether a benefit belongs in a personalized "relevant to you" feed:
 * definite matches, plus "unknown" results that are actually backed by some
 * real comparison against the user's profile (partial evidence is still
 * useful signal). Excludes definite non-matches, and excludes "unknown"
 * results with zero evidence — those are uninformative for every user alike
 * and don't belong in a *personalized* feed.
 */
export function isRelevantForFeed(status: EligibilityStatus, hasEvidence: boolean): boolean {
  if (status === "likely_eligible") return true;
  if (status === "unknown") return hasEvidence;
  return false;
}
