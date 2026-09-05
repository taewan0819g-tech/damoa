import type { Benefit, EligibilityStatus } from "@/types/benefit";
import { getDDayInfo } from "@/lib/dates/dday";
import { getSourceGroup } from "./sourceGroup";

export interface BenefitSummary {
  /**
   * Count of benefits qualifying for the Home high-precision `recommended`
   * bucket (see `countRecommendableBenefits`/`getRecommendedBenefits` with
   * `excludeWeakUnknown: true`) — NOT a raw `likely_eligible` status count.
   * MOIS/Youth eligibility data is always structurally "incomplete" (see
   * ruleEngine.ts), so a real-adapter `likely_eligible` count is almost
   * always 0 even when the user has real benefits worth checking; this
   * field is what the "우선 확인할 혜택" Home card actually renders, and it is
   * deliberately never described to the user as a confirmed-eligible count.
   */
  priorityCount: number;
  governmentYouthCount: number;
  financialCount: number;
  closingSoonCount: number;
}

const CLOSING_SOON_THRESHOLD_DAYS = 14;

/**
 * `priorityCount` is passed in rather than computed here (via
 * `countRecommendableBenefits`) because it needs `profile`/`evidenceById`,
 * which this function deliberately doesn't take so it stays a pure
 * benefits+status aggregate — see the match route for the actual call.
 */
export function getBenefitSummary(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  priorityCount: number
): BenefitSummary {
  let governmentYouthCount = 0;
  let financialCount = 0;
  let closingSoonCount = 0;

  for (const benefit of benefits) {
    const group = getSourceGroup(benefit);
    if (group === "financial") financialCount += 1;
    else governmentYouthCount += 1;

    const dday = getDDayInfo(benefit.application?.endDate);
    if (dday && dday.kind !== "closed" && (dday.kind === "today" || dday.days <= CLOSING_SOON_THRESHOLD_DAYS)) {
      closingSoonCount += 1;
    }
  }

  return { priorityCount, governmentYouthCount, financialCount, closingSoonCount };
}
