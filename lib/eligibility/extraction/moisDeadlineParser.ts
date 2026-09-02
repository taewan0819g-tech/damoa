/**
 * Conservative, deterministic classifier for MOIS' free-text 신청기한
 * (application deadline) field.
 *
 * Today the MOIS adapter never maps 신청기한 into
 * `application.startDate`/`endDate` at all (confirmed via
 * scripts/auditEligibilityCoverage.ts, section 5) — so every MOIS benefit
 * falls into `date_unknown` in `lib/catalog/activeCatalog.ts` regardless of
 * what 신청기한 actually says. That's safe (a missing date is never treated
 * as expired) but throws away real signal: some records spell out an
 * unambiguous machine-parseable date range, and many more explicitly say
 * "always open" or "open until budget runs out" rather than "we don't know".
 *
 * This module only decides whether we have enough confidence to populate
 * `application.startDate`/`endDate` — it NEVER guesses a date. Anything that
 * doesn't unambiguously match one of the known shapes is reported as
 * "unparsed" with no dates set, which is exactly today's behavior.
 */
export type MoisDeadlineType = "date_range" | "open_ended" | "budget_exhaustion" | "unparsed";

export interface MoisDeadlineResult {
  deadlineType: MoisDeadlineType;
  /** ISO `YYYY-MM-DD`. Only ever set when `deadlineType === "date_range"`. */
  startDate?: string;
  /** ISO `YYYY-MM-DD`. Only ever set when `deadlineType === "date_range"`. */
  endDate?: string;
}

// A single "YYYY(.|-|년) M(.|-|월) D(일)?(.)?" date component, tolerant of
// the mixed '.', '-', and 년/월/일 separators MOIS actually uses in practice,
// plus the trailing '.' MOIS commonly appends after the day (e.g.
// "2026.2.2.").
const DATE_PART = String.raw`(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})\s*일?\.?`;
const DATE_RANGE_RE = new RegExp(`${DATE_PART}\\s*[~\\-–]\\s*${DATE_PART}`);

// 채용 시 / 채용시 both occur in real data; \s* between 채용 and 시 covers both.
const OPEN_ENDED_RE = /(상시|연중|수시|채용\s*시)/;
const BUDGET_EXHAUSTION_RE = /(예산\s*소진|소진\s*시|선착순)/;

/**
 * Builds a real calendar-verified ISO date, rejecting overflowed values
 * (e.g. "2026.2.30" or "2026.13.01") instead of silently rolling them into
 * the next month/year — a rollover would be a guess, not a parse.
 */
function toIsoDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Classifies a single MOIS 신청기한 value. Never throws.
 *
 *  - An unambiguous "date ~ date" range with both sides calendar-valid and
 *    chronologically ordered (start <= end) -> `date_range`, with both
 *    dates populated.
 *  - 상시/연중/수시/채용시 (no fixed deadline by design) -> `open_ended`,
 *    no dates populated (there genuinely isn't a specific end date).
 *  - 예산 소진 시/소진 시/선착순 (open until budget runs out — not a fixed
 *    calendar date) -> `budget_exhaustion`, no dates populated.
 *  - Anything else (missing, malformed, or free text we can't confidently
 *    parse — e.g. relative deadlines like "전월 25일까지", or multi-window
 *    schedules) -> `unparsed`, no dates populated. This is intentionally the
 *    fallback: when in doubt, behave exactly like today (date_unknown).
 */
export function parseMoisDeadline(raw: string | undefined): MoisDeadlineResult {
  const text = raw?.trim();
  if (!text) return { deadlineType: "unparsed" };

  const rangeMatch = DATE_RANGE_RE.exec(text);
  if (rangeMatch) {
    const [, y1, m1, d1, y2, m2, d2] = rangeMatch;
    const startDate = toIsoDate(Number(y1), Number(m1), Number(d1));
    const endDate = toIsoDate(Number(y2), Number(m2), Number(d2));
    if (startDate && endDate && startDate <= endDate) {
      return { deadlineType: "date_range", startDate, endDate };
    }
    // Matched the "date ~ date" shape but produced an invalid or
    // out-of-order pair (e.g. an overflowed calendar date, or end before
    // start) — do not guess further; fall through to the keyword checks.
  }

  if (OPEN_ENDED_RE.test(text)) return { deadlineType: "open_ended" };
  if (BUDGET_EXHAUSTION_RE.test(text)) return { deadlineType: "budget_exhaustion" };
  return { deadlineType: "unparsed" };
}
