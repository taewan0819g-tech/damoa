import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import type { Benefit } from "@/types/benefit";
import { getNow } from "@/lib/dates/now";

/**
 * Application-window classification (section 1/23 of the constraint-
 * compatibility spec): computed ONCE per catalog refresh, not per request,
 * and not as a post-hoc filter after eligibility evaluation. Personalized
 * candidate retrieval must never even consider a definitely-expired record,
 * and must never punish a record merely for lacking date information.
 *
 * - "active": a known, currently-open application window (or at least a
 *   known end date that hasn't passed, with no known-future start date).
 * - "upcoming": a known start date strictly in the future — not open yet.
 *   Not shown in the normal personalized feed today; kept separate for a
 *   future "곧 신청 가능" (opening soon) feature.
 * - "expired": a known end date strictly in the past — safe to exclude,
 *   only ever surfaced through an explicit archive/history opt-in.
 * - "date_unknown": no reliable date information (missing or malformed).
 *   NEVER treated as expired — a missing deadline is not evidence of
 *   closure, so these stay fully eligible for personalization.
 */
export type ApplicationState = "active" | "upcoming" | "expired" | "date_unknown";

function parseValidDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = parseISO(raw);
  return isValid(parsed) ? parsed : undefined;
}

export function classifyApplicationState(
  benefit: Pick<Benefit, "application">,
  referenceDate: Date = getNow()
): ApplicationState {
  const end = parseValidDate(benefit.application?.endDate);
  const start = parseValidDate(benefit.application?.startDate);

  if (end && differenceInCalendarDays(end, referenceDate) < 0) return "expired";
  if (start && differenceInCalendarDays(start, referenceDate) > 0) return "upcoming";
  if (end) return "active"; // known end date, not in the past, no known-future start blocking it
  return "date_unknown"; // no verifiable end date (missing or malformed) -> never assumed expired
}

export interface ClassifiedCatalog {
  active: Benefit[];
  upcoming: Benefit[];
  expired: Benefit[];
  dateUnknown: Benefit[];
}

/**
 * Splits a catalog into the four application-state buckets. Pure,
 * synchronous, O(catalog size) — meant to run once per catalog refresh (see
 * providers/index.ts's reference-stability cache), never per request.
 */
export function classifyCatalog(benefits: Benefit[], referenceDate: Date = getNow()): ClassifiedCatalog {
  const classified: ClassifiedCatalog = { active: [], upcoming: [], expired: [], dateUnknown: [] };
  for (const benefit of benefits) {
    const state = classifyApplicationState(benefit, referenceDate);
    if (state === "active") classified.active.push(benefit);
    else if (state === "upcoming") classified.upcoming.push(benefit);
    else if (state === "expired") classified.expired.push(benefit);
    else classified.dateUnknown.push(benefit);
  }
  return classified;
}
