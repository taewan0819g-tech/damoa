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
 * Resolves a `DDayInfo` to a single "days until deadline" number for
 * `compareDeadlineProximity`, or `undefined` when there's nothing actionable
 * to rank on. `"today"` collapses to `0` (same calendar-day urgency as a
 * literal `D-0`), `"upcoming"` keeps its `days` (always >= 1, since `0` is
 * `"today"`), and everything else — missing/malformed date, or `"closed"` —
 * resolves to `undefined`. `"closed"` is deliberately treated as
 * non-actionable here (same bucket as unknown) rather than "worse than
 * unknown": production catalog admission (`getCatalogWithCandidateIndex`)
 * already excludes definitely-expired records before this comparator ever
 * runs, so a `"closed"` result reaching this comparator at all should be
 * rare/non-production-path (e.g. a stale `referenceDate` in a test), and
 * this comparator's job is deadline-proximity ranking, not expiry filtering.
 */
function resolveComparableDays(dday: DDayInfo | null): number | undefined {
  if (!dday) return undefined;
  if (dday.kind === "today") return 0;
  if (dday.kind === "upcoming") return dday.days;
  return undefined; // "closed"
}

/**
 * Deterministic comparator for deadline-proximity tiebreaks (used by
 * `getRecommendedBenefits` and `getUnknownBenefits`). Returns a negative
 * number when `aEndDate` should sort first, positive when `bEndDate` should
 * sort first, and exactly `0` when neither side resolves to a usable
 * deadline — callers MUST fall through to their next comparator key (e.g.
 * benefit id) on a `0` result rather than treating it as "close enough."
 *
 * Rules:
 *   - today vs upcoming -> today first (today is D-0, strictly nearer than any D-N with N >= 1)
 *   - today vs unknown -> today first
 *   - today vs today -> tie
 *   - upcoming finite vs upcoming finite -> nearer deadline first
 *   - upcoming vs unknown -> the upcoming one first
 *   - unknown vs unknown -> tie (`0`)
 * "Unknown" here means `getDDayInfo` didn't resolve to `"today"` or
 * `"upcoming"` (missing/malformed date, or already-closed) — see
 * `resolveComparableDays` for why `"closed"` is folded into this bucket
 * rather than ranked separately.
 *
 * Fixes two latent bugs found across two review passes on the same PR:
 *  1. The original inline logic computed `aDays - bDays` with both sides
 *     defaulting to `Infinity` when neither had a resolvable upcoming date.
 *     `Infinity - Infinity` is `NaN`, and `NaN !== 0` is `true`, so callers
 *     doing `if (ddayDiff !== 0) return ddayDiff` returned `NaN` from the
 *     sort comparator instead of falling through to the documented final
 *     benefit-id tiebreak. `Array.prototype.sort` treats a `NaN` comparator
 *     result as "keep relative order," silently replacing the documented
 *     deterministic id ordering with incidental pre-sort array order
 *     whenever two `date_unknown` benefits were compared — the common case,
 *     since the large majority of the catalog has no parseable application
 *     end date at all.
 *  2. The first fix for (1) only ever treated `kind === "upcoming"` as a
 *     finite/comparable deadline, silently dropping `kind === "today"` into
 *     the same "unknown" bucket as a missing date. A benefit closing TODAY
 *     was therefore tying with (and could sort behind, via the id
 *     tiebreak) a benefit with no deadline at all, instead of ranking
 *     strictly ahead of it as D-0 must. Fixed by `resolveComparableDays`
 *     treating `"today"` as `0`, distinct from `undefined`.
 */
export function compareDeadlineProximity(
  aEndDate: string | undefined,
  bEndDate: string | undefined,
  referenceDate: Date = getNow()
): number {
  const aDays = resolveComparableDays(getDDayInfo(aEndDate, referenceDate));
  const bDays = resolveComparableDays(getDDayInfo(bEndDate, referenceDate));

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
