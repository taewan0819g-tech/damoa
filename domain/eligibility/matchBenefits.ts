import type { Benefit, BenefitMatchResult, UserProfile } from "@/types";
import { evaluateEligibility } from "@/lib/eligibility/ruleEngine";

export function matchBenefits(benefits: Benefit[], profile: UserProfile): BenefitMatchResult[] {
  return benefits.map((benefit) => ({
    benefitId: benefit.id,
    status: evaluateEligibility(benefit, profile),
  }));
}

export function matchBenefit(benefit: Benefit, profile: UserProfile): BenefitMatchResult {
  return { benefitId: benefit.id, status: evaluateEligibility(benefit, profile) };
}
