import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { getNow } from "@/lib/dates/now";

export type DDayInfo =
  | { kind: "upcoming"; days: number; label: `D-${number}` }
  | { kind: "today"; label: "오늘 마감" }
  | { kind: "closed"; label: "마감됨" };

/**
 * Computes a D-Day label from an application end date. Returns null when the
 * date is missing or malformed so callers can hide deadline UI instead of
 * showing a broken value.
 */
export function getDDayInfo(endDate: string | undefined, referenceDate: Date = getNow()): DDayInfo | null {
  if (!endDate) return null;
  const parsed = parseISO(endDate);
  if (!isValid(parsed)) return null;

  const days = differenceInCalendarDays(parsed, referenceDate);
  if (days < 0) return { kind: "closed", label: "마감됨" };
  if (days === 0) return { kind: "today", label: "오늘 마감" };
  return { kind: "upcoming", days, label: `D-${days}` };
}

/**
 * Deterministic comparator for deadline-proximity tiebreaks (used by
 * `getRecommendedBenefits` and `getUnknownBenefits`). Returns a negative
 * number when `aEndDate` should sort first, positive when `bEndDate` should
 * sort first, and exactly `0` when neither side resolves to a usable
 * upcoming deadline — callers MUST fall through to their next comparator key
 * (e.g. benefit id) on a `0` result rather than treating it as "close
 * enough."
 *
 * Rules:
 *   - finite vs finite -> nearer deadline first
 *   - finite vs unknown -> the finite one first
 *   - unknown vs unknown -> tie (`0`)
 * "Unknown" here means `getDDayInfo` didn't resolve to an `"upcoming"`
 * D-day (missing/malformed date, already-closed, or due today) — matching
 * the prior `kind === "upcoming" ? days : Infinity` treatment of those
 * cases, so this only changes how ties are resolved, never which benefit is
 * considered "sooner."
 *
 * Fixes a latent bug: the previous inline logic computed
 * `aDays - bDays` with both sides defaulting to `Infinity` when neither had
 * a resolvable upcoming date. `Infinity - Infinity` is `NaN`, and
 * `NaN !== 0` is `true`, so callers doing `if (ddayDiff !== 0) return
 * ddayDiff` returned `NaN` from the sort comparator instead of falling
 * through to the documented final benefit-id tiebreak.
 * `Array.prototype.sort` treats a `NaN` comparator result as "keep relative
 * order," which silently replaced the documented deterministic id ordering
 * with incidental pre-sort array order whenever two `date_unknown` benefits
 * were compared — the common case, since the large majority of the catalog
 * has no parseable application end date at all.
 */
export function compareDeadlineProximity(
  aEndDate: string | undefined,
  bEndDate: string | undefined,
  referenceDate: Date = getNow()
): number {
  const aDday = getDDayInfo(aEndDate, referenceDate);
  const bDday = getDDayInfo(bEndDate, referenceDate);
  const aDays = aDday?.kind === "upcoming" ? aDday.days : undefined;
  const bDays = bDday?.kind === "upcoming" ? bDday.days : undefined;

  if (aDays === undefined && bDays === undefined) return 0;
  if (aDays === undefined) return 1;
  if (bDays === undefined) return -1;
  return aDays - bDays;
}

export function formatDateRange(startDate?: string, endDate?: string): string | null {
  const format = (iso: string) => {
    const d = parseISO(iso);
    if (!isValid(d)) return null;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  const start = startDate ? format(startDate) : null;
  const end = endDate ? format(endDate) : null;

  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~`;
  if (end) return `~ ${end}`;
  return null;
}
