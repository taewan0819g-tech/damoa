/**
 * Shared numeric-interval compatibility model.
 *
 * This is the single implementation of "is a value/range compatible with a
 * boundary condition" used by BOTH candidate retrieval and the final rule
 * engine (see ruleEngine.ts's `range_within_interval` operator, used via the
 * shared `compare()`/`evaluateRule()` path that candidateIndex.ts also
 * calls) — so income/threshold semantics can never drift between the two
 * stages.
 *
 * The core bug this fixes: Korean eligibility text distinguishes 이상 (>=,
 * inclusive) from 초과 (>, strict), and 이하 (<=, inclusive) from 미만 (<,
 * strict). A naive `{min, max}` tuple can't represent that distinction — collapsing
 * "미만" (strict) and "이하" (inclusive) into the same closed range silently
 * changes eligibility for a user whose value sits exactly on the boundary
 * (e.g. exactly 35,000,000원 income against a "35,000,000원 미만" policy must
 * FAIL, but against a "35,000,000원 이하" policy must PASS). `Interval`
 * carries `minInclusive`/`maxInclusive` explicitly so that distinction
 * survives all the way from text extraction to the final decision.
 */

/** `undefined` on either side means unbounded on that side. */
export interface Interval {
  min?: number;
  max?: number;
  minInclusive: boolean;
  maxInclusive: boolean;
}

export type IntervalCompat = "pass" | "fail" | "unknown";

/** 이상 X (>= X, inclusive lower bound, unbounded above). */
export function atLeast(x: number): Interval {
  return { min: x, minInclusive: true, maxInclusive: true };
}

/** 초과 X (> X, strict lower bound, unbounded above). */
export function moreThan(x: number): Interval {
  return { min: x, minInclusive: false, maxInclusive: true };
}

/** 이하 X (<= X, inclusive upper bound, unbounded below). */
export function atMost(x: number): Interval {
  return { max: x, minInclusive: true, maxInclusive: true };
}

/** 미만 X (< X, strict upper bound, unbounded below). */
export function lessThan(x: number): Interval {
  return { max: x, minInclusive: true, maxInclusive: false };
}

/** Builds an Interval from one of the four Korean boundary words. */
export function intervalFromBoundaryWord(word: "이상" | "초과" | "이하" | "미만", amount: number): Interval {
  switch (word) {
    case "이상":
      return atLeast(amount);
    case "초과":
      return moreThan(amount);
    case "이하":
      return atMost(amount);
    case "미만":
      return lessThan(amount);
  }
}

/**
 * Compares a single known exact value against an interval. Always resolves
 * to pass/fail — there is no partial-overlap case for a single scalar.
 */
export function compareValueToInterval(value: number, interval: Interval): "pass" | "fail" {
  if (interval.min !== undefined) {
    const ok = interval.minInclusive ? value >= interval.min : value > interval.min;
    if (!ok) return "fail";
  }
  if (interval.max !== undefined) {
    const ok = interval.maxInclusive ? value <= interval.max : value < interval.max;
    if (!ok) return "fail";
  }
  return "pass";
}

/**
 * Compares a user's possible-value RANGE (e.g. an income band converted to
 * `{min, max}` KRW, or a legacy exact scalar represented as the degenerate
 * range `{min: x, max: x}`) against a policy interval. This is the U-vs-P
 * set-compatibility model:
 *  - The user's entire range lies outside the interval -> every possible
 *    real value fails -> "fail" (safe to prune).
 *  - The user's entire range lies inside the interval -> every possible
 *    real value passes -> "pass".
 *  - Otherwise the range straddles a boundary -> we can't prove which side
 *    the user's real value is on -> "unknown" (never prune, never promote).
 */
export function compareRangeToInterval(userRange: { min: number; max: number }, interval: Interval): IntervalCompat {
  if (interval.min !== undefined) {
    const violatesMin = interval.minInclusive ? userRange.max < interval.min : userRange.max <= interval.min;
    if (violatesMin) return "fail";
  }
  if (interval.max !== undefined) {
    const violatesMax = interval.maxInclusive ? userRange.min > interval.max : userRange.min >= interval.max;
    if (violatesMax) return "fail";
  }

  const minOk = interval.min === undefined || (interval.minInclusive ? userRange.min >= interval.min : userRange.min > interval.min);
  const maxOk = interval.max === undefined || (interval.maxInclusive ? userRange.max <= interval.max : userRange.max < interval.max);
  return minOk && maxOk ? "pass" : "unknown";
}

export function isInterval(value: unknown): value is Interval {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Interval).minInclusive === "boolean" &&
    typeof (value as Interval).maxInclusive === "boolean"
  );
}
