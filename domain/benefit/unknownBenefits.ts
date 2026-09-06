import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { compareDeadlineProximity } from "@/lib/dates/dday";
import { resolvePersonalizationEvidence, STRENGTH_RANK, type PersonalizationEvidence } from "./personalization";
import { hasUnresolvedLocalScopeConflict } from "./localScope";

export interface GetUnknownBenefitsOptions {
  /** Benefit ids already placed in `recommended` — excluded here so the two bounded preview arrays never overlap. */
  excludeIds?: Set<string>;
  /** Precomputed personalization evidence per benefit id (see `matchBenefitsDetailed`); falls back to on-demand computation when omitted. */
  evidenceById?: Map<string, PersonalizationEvidence>;
  /**
   * When true, excludes an UNKNOWN benefit whose publishing organization has
   * an unresolved local-scope conflict with the profile's residence (see
   * `hasUnresolvedLocalScopeConflict` in ./localScope) from this bounded
   * preview list. Intended ONLY for the bounded Home "확인이 필요해요"
   * preview — a scarce, small slot count where an obviously-wrong-region
   * record (e.g. a different province's local government benefit with no
   * verified region rule tying it to this profile) shouldn't occupy a slot
   * a genuinely relevant/national benefit could use instead.
   *
   * This is purely a preview-admission filter, same philosophy as
   * `getRecommendedBenefits`' `excludeWeakUnknown`:
   *   - never marks the benefit `not_eligible`
   *   - never removes it from full `/benefits` browse/search (callers that
   *     want full discovery recall must leave this false, the default)
   *   - never mutates `statusById` or any source data
   * Filtering happens BEFORE sorting/slicing to `limit`, so the preview is
   * naturally "refilled" from the next-ranked eligible candidates rather
   * than shrinking below `limit` when a conflicted item would otherwise
   * have taken a slot.
   */
  excludeLocalScopeConflicts?: boolean;
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
 * precisely to surface benefits worth a manual look. It also keeps
 * unresolved-local-scope-conflicted benefits by default — see
 * `excludeLocalScopeConflicts` for the opt-in bounded-preview exception.
 */
export function getUnknownBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  limit = 6,
  options: GetUnknownBenefitsOptions = {}
): Benefit[] {
  const { excludeIds, evidenceById, excludeLocalScopeConflicts = false } = options;

  return benefits
    .filter((b) => statusById.get(b.id) === "unknown" && !excludeIds?.has(b.id))
    .map((benefit) => ({ benefit, evidence: resolvePersonalizationEvidence(benefit, profile, evidenceById) }))
    .filter(
      (c) =>
        !excludeLocalScopeConflicts || !hasUnresolvedLocalScopeConflict(c.benefit, profile, c.evidence.regionSpecificity)
    )
    .sort((a, b) => {
      const strengthDiff = STRENGTH_RANK[a.evidence.strength] - STRENGTH_RANK[b.evidence.strength];
      if (strengthDiff !== 0) return strengthDiff;

      const ddayDiff = compareDeadlineProximity(a.benefit.application?.endDate, b.benefit.application?.endDate);
      if (ddayDiff !== 0) return ddayDiff;

      return a.benefit.id.localeCompare(b.benefit.id);
    })
    .slice(0, limit)
    .map((e) => e.benefit);
}
