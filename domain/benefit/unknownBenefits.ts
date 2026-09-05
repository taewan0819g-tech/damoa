import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { getDDayInfo } from "@/lib/dates/dday";
import { resolvePersonalizationEvidence, STRENGTH_RANK, type PersonalizationEvidence } from "./personalization";

export interface GetUnknownBenefitsOptions {
  /** Benefit ids already placed in `recommended` — excluded here so the two bounded preview arrays never overlap. */
  excludeIds?: Set<string>;
  /** Precomputed personalization evidence per benefit id (see `matchBenefitsDetailed`); falls back to on-demand computation when omitted. */
  evidenceById?: Map<string, PersonalizationEvidence>;
}

/**
 * Benefits whose eligibility couldn't be determined from the current
 * profile (e.g. missing required fields, or the source data has no
 * structured eligibility criteria at all). Surfaced separately from
 * "likely eligible" recommendations so the user knows there's more to
 * check rather than assuming those benefits don't apply to them — an
 * "unknown" status must never be silently dropped or presented as a
 * rejection.
 *
 * Ranked by personalization strength (stronger evidence first, same
 * strength signal `getRecommendedBenefits` uses) then deadline proximity,
 * then benefit id — but, unlike the home "recommended" list, this bucket
 * keeps WEAK-evidence unknowns rather than dropping them, since it exists
 * precisely to surface benefits worth a manual look.
 */
export function getUnknownBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  limit = 6,
  options: GetUnknownBenefitsOptions = {}
): Benefit[] {
  const { excludeIds, evidenceById } = options;

  return benefits
    .filter((b) => statusById.get(b.id) === "unknown" && !excludeIds?.has(b.id))
    .map((benefit) => ({ benefit, evidence: resolvePersonalizationEvidence(benefit, profile, evidenceById) }))
    .sort((a, b) => {
      const strengthDiff = STRENGTH_RANK[a.evidence.strength] - STRENGTH_RANK[b.evidence.strength];
      if (strengthDiff !== 0) return strengthDiff;

      const aDday = getDDayInfo(a.benefit.application?.endDate);
      const bDday = getDDayInfo(b.benefit.application?.endDate);
      const aDays = aDday?.kind === "upcoming" ? aDday.days : Infinity;
      const bDays = bDday?.kind === "upcoming" ? bDday.days : Infinity;
      const ddayDiff = aDays - bDays;
      if (ddayDiff !== 0) return ddayDiff;

      return a.benefit.id.localeCompare(b.benefit.id);
    })
    .slice(0, limit)
    .map((e) => e.benefit);
}
