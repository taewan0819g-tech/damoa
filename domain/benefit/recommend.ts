import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { getDDayInfo } from "@/lib/dates/dday";

const STATUS_RANK: Record<EligibilityStatus, number> = { likely_eligible: 0, unknown: 1, not_eligible: 2 };

/**
 * Simple, deterministic sort — not an AI or scored ranking. Prioritizes
 * benefits by eligibility status, then interest-category overlap, then
 * closer deadlines. No numeric score is ever surfaced to the user.
 */
export function getRecommendedBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  limit = 6
): Benefit[] {
  const interests = new Set(profile.interests ?? []);

  return [...benefits]
    .filter((b) => statusById.get(b.id) !== "not_eligible")
    .sort((a, b) => {
      const statusDiff =
        STATUS_RANK[statusById.get(a.id) ?? "unknown"] - STATUS_RANK[statusById.get(b.id) ?? "unknown"];
      if (statusDiff !== 0) return statusDiff;

      const interestDiff = Number(interests.has(b.category)) - Number(interests.has(a.category));
      if (interestDiff !== 0) return interestDiff;

      const aDday = getDDayInfo(a.application?.endDate);
      const bDday = getDDayInfo(b.application?.endDate);
      const aDays = aDday?.kind === "upcoming" ? aDday.days : Infinity;
      const bDays = bDday?.kind === "upcoming" ? bDday.days : Infinity;
      return aDays - bDays;
    })
    .slice(0, limit);
}
