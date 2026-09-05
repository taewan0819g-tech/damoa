import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { getDDayInfo } from "@/lib/dates/dday";
import { getRecommendedBenefits } from "./recommend";
import type { PersonalizationEvidence } from "./personalization";

export type BenefitSort = "recommended" | "deadline" | "latest" | "rate";

export function sortBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  sort: BenefitSort,
  evidenceById?: Map<string, PersonalizationEvidence>
): Benefit[] {
  switch (sort) {
    case "recommended": {
      // The server-side /api/benefits/match endpoint never returns
      // not_eligible benefits, so `benefits` here is already just
      // likely_eligible + unknown — no separate not_eligible bucket needed.
      // Uses the SAME comparator as the home preview (see recommend.ts) —
      // full discovery recall (excludeWeakUnknown stays false/default) so
      // weak-evidence candidates are still discoverable here, just ranked
      // below stronger ones.
      return getRecommendedBenefits(benefits, statusById, profile, benefits.length, { evidenceById });
    }
    case "deadline":
      return [...benefits].sort((a, b) => {
        const aInfo = getDDayInfo(a.application?.endDate);
        const bInfo = getDDayInfo(b.application?.endDate);
        const aDays = aInfo?.kind === "upcoming" ? aInfo.days : aInfo?.kind === "today" ? 0 : Infinity;
        const bDays = bInfo?.kind === "upcoming" ? bInfo.days : bInfo?.kind === "today" ? 0 : Infinity;
        return aDays - bDays;
      });
    case "latest":
      return [...benefits].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    case "rate":
      return [...benefits].sort((a, b) => {
        const aRate = a.financial?.maxInterestRate ?? a.financial?.interestRate ?? -Infinity;
        const bRate = b.financial?.maxInterestRate ?? b.financial?.interestRate ?? -Infinity;
        return bRate - aRate;
      });
    default:
      return benefits;
  }
}
