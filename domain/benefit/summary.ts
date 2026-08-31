import type { Benefit, EligibilityStatus } from "@/types/benefit";
import { getDDayInfo } from "@/lib/dates/dday";
import { getSourceGroup } from "./sourceGroup";

export interface BenefitSummary {
  likelyEligibleCount: number;
  governmentYouthCount: number;
  financialCount: number;
  closingSoonCount: number;
}

const CLOSING_SOON_THRESHOLD_DAYS = 14;

export function getBenefitSummary(benefits: Benefit[], statusById: Map<string, EligibilityStatus>): BenefitSummary {
  let likelyEligibleCount = 0;
  let governmentYouthCount = 0;
  let financialCount = 0;
  let closingSoonCount = 0;

  for (const benefit of benefits) {
    const status = statusById.get(benefit.id) ?? "unknown";
    if (status === "likely_eligible") likelyEligibleCount += 1;

    const group = getSourceGroup(benefit);
    if (group === "financial") financialCount += 1;
    else governmentYouthCount += 1;

    const dday = getDDayInfo(benefit.application?.endDate);
    if (dday && dday.kind !== "closed" && (dday.kind === "today" || dday.days <= CLOSING_SOON_THRESHOLD_DAYS)) {
      closingSoonCount += 1;
    }
  }

  return { likelyEligibleCount, governmentYouthCount, financialCount, closingSoonCount };
}
