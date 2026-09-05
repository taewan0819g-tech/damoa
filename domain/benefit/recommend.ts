import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { getDDayInfo } from "@/lib/dates/dday";
import { matchesUserInterest } from "./topics";
import {
  resolvePersonalizationEvidence,
  STRENGTH_RANK,
  REGION_SPECIFICITY_RANK,
  type PersonalizationEvidence,
} from "./personalization";
import { hasUnresolvedLocalScopeConflict } from "./localScope";

const STATUS_RANK: Record<EligibilityStatus, number> = { likely_eligible: 0, unknown: 1, not_eligible: 2 };

export interface GetRecommendedBenefitsOptions {
  /**
   * Precomputed personalization evidence per benefit id (see
   * `matchBenefitsDetailed`) — avoids re-running the rule engine here.
   * Falls back to computing it on demand per-benefit when omitted or when a
   * benefit id is missing, so older 4-argument call sites keep working.
   */
  evidenceById?: Map<string, PersonalizationEvidence>;
  /**
   * When true, drops UNKNOWN-status benefits whose personalization evidence
   * is WEAK (age-only, targetScope-only, or no specific matched dimension)
   * instead of merely ranking them last. Also drops UNKNOWN-status benefits
   * with an unresolved local-scope conflict (see
   * `hasUnresolvedLocalScopeConflict` in ./localScope — e.g. a benefit
   * published by another province/city's local government with no verified
   * region rule tying it to the profile's own residence). `likely_eligible`
   * benefits are NEVER dropped by this flag for either reason —
   * deterministic rule-engine status already proves eligibility,
   * independent of personalization "strength" or unresolved local scope.
   *
   * Use this ONLY for a bounded preview (e.g. the home "다모아 추천" list) so
   * it never pads out to `limit` with weak or geographically-unverified
   * filler. Full-catalog/listing views (see domain/benefit/sort.ts) must
   * keep full discovery recall and so must leave this false (the default) —
   * weak/unresolved-local-scope candidates still appear, just ranked below
   * stronger ones. A benefit dropped here is never marked not_eligible and
   * never removed from full browse — it still surfaces via
   * `getUnknownBenefits` (Home "확인이 필요해요" / needsReview).
   */
  excludeWeakUnknown?: boolean;
}

/**
 * Deterministic personalization comparator — not an AI or scored ranking,
 * and no numeric score is ever surfaced to the user. Order:
 *   1. EligibilityStatus (likely_eligible before unknown; not_eligible is
 *      already filtered out before this ever runs)
 *   2. personalization strength (strong > moderate > weak)
 *   3. distinct specific matched-dimension count (more > fewer)
 *   4. region specificity (exact city > province-wide > no verified region
 *      match) — ranking/tie-breaking only, never changes matchRegion()'s
 *      own pass/fail/unknown result
 *   5. user-interest overlap, via `matchesUserInterest` (see
 *      domain/benefit/topics.ts) — LOW-PRIORITY tie-breaker only, even though
 *      the historical over-tagging bugs it used to inherit from raw
 *      `category` equality (see docs/beta-personalization-audit.md §4/§6)
 *      are now fixed at the source. It must still never outrank verified
 *      eligibility/personalization evidence.
 *   6. application deadline proximity (sooner first)
 *   7. benefit id — stable final tie-breaker so ordering is deterministic
 *      even when every prior key ties.
 */
export function getRecommendedBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  limit = 6,
  options: GetRecommendedBenefitsOptions = {}
): Benefit[] {
  const { evidenceById, excludeWeakUnknown = false } = options;
  const interests = new Set(profile.interests ?? []);

  const candidates = benefits
    .filter((b) => statusById.get(b.id) !== "not_eligible")
    .map((benefit) => ({
      benefit,
      status: statusById.get(benefit.id) ?? "unknown",
      evidence: resolvePersonalizationEvidence(benefit, profile, evidenceById),
    }))
    .filter((c) => !excludeWeakUnknown || c.status === "likely_eligible" || c.evidence.strength !== "weak")
    .filter(
      (c) =>
        !excludeWeakUnknown ||
        c.status === "likely_eligible" ||
        !hasUnresolvedLocalScopeConflict(c.benefit, profile, c.evidence.regionSpecificity)
    );

  return candidates
    .sort((a, b) => {
      const statusDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (statusDiff !== 0) return statusDiff;

      const strengthDiff = STRENGTH_RANK[a.evidence.strength] - STRENGTH_RANK[b.evidence.strength];
      if (strengthDiff !== 0) return strengthDiff;

      const dimensionDiff = b.evidence.specificDimensionCount - a.evidence.specificDimensionCount;
      if (dimensionDiff !== 0) return dimensionDiff;

      const regionDiff =
        REGION_SPECIFICITY_RANK[a.evidence.regionSpecificity] - REGION_SPECIFICITY_RANK[b.evidence.regionSpecificity];
      if (regionDiff !== 0) return regionDiff;

      const interestDiff =
        Number(matchesUserInterest(b.benefit, interests)) - Number(matchesUserInterest(a.benefit, interests));
      if (interestDiff !== 0) return interestDiff;

      const aDday = getDDayInfo(a.benefit.application?.endDate);
      const bDday = getDDayInfo(b.benefit.application?.endDate);
      const aDays = aDday?.kind === "upcoming" ? aDday.days : Infinity;
      const bDays = bDday?.kind === "upcoming" ? bDday.days : Infinity;
      const ddayDiff = aDays - bDays;
      if (ddayDiff !== 0) return ddayDiff;

      return a.benefit.id.localeCompare(b.benefit.id);
    })
    .slice(0, limit)
    .map((c) => c.benefit);
}

/**
 * Count of benefits that would qualify for the Home high-precision
 * `recommended` bucket (same admission rule as `getRecommendedBenefits`
 * called with `excludeWeakUnknown: true`), over the FULL relevant set rather
 * than a bounded preview. Exists so the Home summary card can show a
 * truthful "우선 확인할 혜택" total without sorting/slicing thousands of
 * records just to report a count (see `getBenefitSummary`'s caller in the
 * match route).
 */
export function countRecommendableBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  evidenceById?: Map<string, PersonalizationEvidence>
): number {
  let count = 0;
  for (const benefit of benefits) {
    const status = statusById.get(benefit.id) ?? "unknown";
    if (status === "not_eligible") continue;
    if (status === "likely_eligible") {
      count += 1;
      continue;
    }
    const evidence = resolvePersonalizationEvidence(benefit, profile, evidenceById);
    if (evidence.strength === "weak") continue;
    if (hasUnresolvedLocalScopeConflict(benefit, profile, evidence.regionSpecificity)) continue;
    count += 1;
  }
  return count;
}
