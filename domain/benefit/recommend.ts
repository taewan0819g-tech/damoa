import type { Benefit, EligibilityStatus } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { getDDayInfo } from "@/lib/dates/dday";
import { countUserInterestOverlap } from "./topics";
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
 *   2. `totalIntersectionCount` (= `specificDimensionCount` +
 *      `interestOverlapCount`) DESC — a single combined "how much of this
 *      benefit's structured eligibility AND selected-interest evidence
 *      intersects with this profile" measure, ranking-only and NEVER
 *      surfaced to the user (like every other numeric rank here). Combining
 *      the two counts before comparing (rather than treating dimension
 *      count and interest overlap as fully separate tiers) means a benefit
 *      that matches on, say, 2 eligibility dimensions + 1 interest ranks
 *      above one matching only 1 dimension + 1 interest, without a specific
 *      matched dimension ever being treated as strictly more or less
 *      valuable than a specific matched interest.
 *   3. personalization strength (strong > moderate > weak)
 *   4. region specificity (exact city > province-wide > no verified region
 *      match) — ranking/tie-breaking only, never changes matchRegion()'s
 *      own pass/fail/unknown result
 *   5. selected-interest overlap count DESC (secondary tie-break), via
 *      `countUserInterestOverlap` (see domain/benefit/topics.ts) — breaks
 *      remaining ties in favor of more distinct matched selected interests
 *      once every coarser key above is equal. When `profile.interests` is
 *      empty every candidate scores 0 on both this key and the interest
 *      component of `totalIntersectionCount`, so both keys always tie and
 *      ranking falls through to the same ordering as before
 *      interest-intersection ranking existed.
 *   6. application deadline proximity (sooner first)
 *   7. benefit id — stable final tie-breaker so ordering is deterministic
 *      even when every prior key ties.
 *
 * All of this runs AFTER eligibility/safety admission (the not_eligible
 * filter and, for `excludeWeakUnknown`, the weak-evidence and
 * unresolved-local-scope filters below) — it can reorder among admitted
 * candidates but can never resurrect a filtered-out benefit.
 */
export function getRecommendedBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  profile: UserProfile,
  limit = 6,
  options: GetRecommendedBenefitsOptions = {}
): Benefit[] {
  const { evidenceById, excludeWeakUnknown = false } = options;
  const interests = profile.interests ?? [];

  const candidates = benefits
    .filter((b) => statusById.get(b.id) !== "not_eligible")
    .map((benefit) => {
      const evidence = resolvePersonalizationEvidence(benefit, profile, evidenceById);
      const interestOverlapCount = countUserInterestOverlap(benefit, interests);
      return {
        benefit,
        status: statusById.get(benefit.id) ?? "unknown",
        evidence,
        interestOverlapCount,
        // Ranking-only combined measure -- never surfaced to the user.
        totalIntersectionCount: evidence.specificDimensionCount + interestOverlapCount,
      };
    })
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

      const totalIntersectionDiff = b.totalIntersectionCount - a.totalIntersectionCount;
      if (totalIntersectionDiff !== 0) return totalIntersectionDiff;

      const strengthDiff = STRENGTH_RANK[a.evidence.strength] - STRENGTH_RANK[b.evidence.strength];
      if (strengthDiff !== 0) return strengthDiff;

      const regionDiff =
        REGION_SPECIFICITY_RANK[a.evidence.regionSpecificity] - REGION_SPECIFICITY_RANK[b.evidence.regionSpecificity];
      if (regionDiff !== 0) return regionDiff;

      const interestDiff = b.interestOverlapCount - a.interestOverlapCount;
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
