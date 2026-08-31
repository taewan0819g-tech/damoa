import type { Benefit, EligibilityStatus } from "@/types/benefit";
import { getDDayInfo } from "@/lib/dates/dday";

/**
 * Benefits whose eligibility couldn't be determined from the current
 * profile (e.g. missing required fields, or the source data has no
 * structured eligibility criteria at all). Surfaced separately from
 * "likely eligible" recommendations so the user knows there's more to
 * check rather than assuming those benefits don't apply to them — an
 * "unknown" status must never be silently dropped or presented as a
 * rejection.
 */
export function getUnknownBenefits(
  benefits: Benefit[],
  statusById: Map<string, EligibilityStatus>,
  limit = 6
): Benefit[] {
  return [...benefits]
    .filter((b) => statusById.get(b.id) === "unknown")
    .sort((a, b) => {
      const aDday = getDDayInfo(a.application?.endDate);
      const bDday = getDDayInfo(b.application?.endDate);
      const aDays = aDday?.kind === "upcoming" ? aDday.days : Infinity;
      const bDays = bDday?.kind === "upcoming" ? bDday.days : Infinity;
      return aDays - bDays;
    })
    .slice(0, limit);
}
