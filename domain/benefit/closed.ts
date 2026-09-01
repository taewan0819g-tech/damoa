import type { Benefit } from "@/types";
import { getDDayInfo } from "@/lib/dates/dday";

/**
 * True when a benefit's application window has definitively closed (its
 * `application.endDate` is in the past). Benefits with no end date, or a
 * malformed one, are never treated as closed — absence of a deadline is not
 * evidence of closure (see getDDayInfo, which returns null in that case).
 */
export function isClosed(benefit: Pick<Benefit, "application">): boolean {
  return getDDayInfo(benefit.application?.endDate)?.kind === "closed";
}
