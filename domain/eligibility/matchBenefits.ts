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
  /**
   * True when at least one rule was actually checked against real profile
   * data (pass OR fail). Diagnostic only — do NOT use this to gate
   * personalized relevance (a rule that only ever failed is not a reason to
   * recommend a benefit). See `hasPositiveEvidence`.
   */
  hasEvidence: boolean;
  /**
   * True when at least one rule was actually verified to PASS against real
   * profile data. This is "not disproven" upgraded to "actually connected
   * to this user" — the correct gate for personalized relevance, see
   * `isRelevantForFeed`.
   */
  hasPositiveEvidence: boolean;
}

/**
 * Like `matchBenefits`, but also surfaces per-benefit evidence diagnostics
 * from `evaluateEligibilityDetailed`. Used to build a personalized default
 * feed that can tell an "unknown" backed by real positive matched criteria
 * (worth showing) apart from an "unknown" that's just an absence of any
 * data, or only ever failed a rule buried in an unresolved "any" branch
 * (not worth showing as if it were personalized) — see `isRelevantForFeed`.
 */
export function matchBenefitsDetailed(benefits: Benefit[], profile: UserProfile): BenefitMatchDetailedResult[] {
  return benefits.map((benefit) => {
    const diag = evaluateEligibilityDetailed(benefit, profile);
    return { benefitId: benefit.id, status: diag.status, hasEvidence: diag.hasEvidence, hasPositiveEvidence: diag.hasPositiveEvidence };
  });
}

/**
 * Whether a benefit belongs in a personalized "relevant to you" feed:
 * definite matches, plus "unknown" results that are actually backed by at
 * least one VERIFIED POSITIVE match against the user's profile (age passed,
 * region passed, scope passed, etc.) — not merely "some rule was checked".
 * Excludes definite non-matches, and excludes "unknown" results with zero
 * positive evidence (whether that's zero evidence at all, or evidence that
 * only ever consisted of failed/unresolved rules) — those are uninformative
 * as personalized signal and don't belong in a *personalized* feed, even
 * though they remain fully visible via full-catalog search.
 */
export function isRelevantForFeed(status: EligibilityStatus, hasPositiveEvidence: boolean): boolean {
  if (status === "likely_eligible") return true;
  if (status === "unknown") return hasPositiveEvidence;
  return false;
}
