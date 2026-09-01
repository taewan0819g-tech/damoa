import type {
  Benefit,
  EducationStatus,
  EligibilityRule,
  EligibilityRuleGroup,
  HousingType,
  UserProfile,
} from "@/types";
import { evaluateRule, isGroup } from "./ruleEngine";
import { resolveProfileField } from "./fieldResolver";
import { normalizeProvince } from "./region";
import { atLeast, atMost, lessThan, moreThan, type Interval } from "./interval";

/**
 * Candidate-retrieval layer for personalized matching.
 *
 * The old approach ran the full deterministic rule engine
 * (`evaluateEligibilityDetailed`) over every single catalog record on every
 * request — a "scan everything, then hide what doesn't apply" design. That
 * doesn't scale as the catalog grows (13,000+ MOIS/Youth Center records
 * today) and re-does the same tree-walk for records that plainly have
 * nothing to do with the user, on every request.
 *
 * Instead: build a `CandidateIndex` ONCE whenever the normalized catalog is
 * refreshed (see providers/index.ts, which keeps the merged catalog array
 * reference stable across requests while every provider's own cache is
 * still warm), then reuse it for every personalized request.
 *
 * ---------------------------------------------------------------------------
 * Section 2026-09: real per-dimension retrieval indexes
 * ---------------------------------------------------------------------------
 * The first version of this file only sorted verified-necessary rules into
 * `constrained`/`constrainedByDimension`, but `getCandidateBenefits` still
 * looped over EVERY constrained entry on every request regardless of what
 * the user's profile actually contained — a sparse profile (e.g. age only)
 * paid the same cost as a rich one. That defeats the entire point: the
 * user's verified input should shrink the amount of work a request does,
 * not just get checked against a fixed-size scan.
 *
 * This version adds real, value-keyed indexes per dimension, built once at
 * catalog-refresh time (`buildCandidateIndex`), so a per-request lookup only
 * ever touches the (usually small) subset of entries that could possibly be
 * affected by the profile fields the user actually provided:
 *   - age / income: sorted-by-bound arrays (`AgeIntervalIndex` /
 *     `IncomeFieldIndex`) queried via binary search (`partitionPoint`) to
 *     find the definite-fail boundary in O(log n + matches) instead of a
 *     linear scan of every age/income rule in the catalog.
 *   - employment / education / housing / business: reverse value indexes
 *     (`Map<"field:value", entries>`) built by enumerating each rule's
 *     KNOWN, FINITE profile-value domain (e.g. the 5 `EducationStatus`
 *     values, or the 2 boolean values for `homeowner`/`businessOwner`) —
 *     O(1)/O(domain size) lookup instead of scanning every entry with a
 *     rule in that dimension.
 *   - applicant scope (개인/가구/법인·시설·단체/소상공인): split at build time
 *     into an `alwaysFail` bucket (법인/시설/단체-only requirements, which
 *     `matchTargetScope` fails unconditionally for Damoa's natural-person
 *     profiles — see targetScope.ts) and a `businessOwnerRelevant` bucket
 *     (소상공인-only requirements, checked only when `businessOwner` is
 *     known).
 *   - region: a `Map<province, entries>` built from every `region_in`
 *     spec's province. A user's known province immediately proves EVERY
 *     entry not mentioning that province at all definitely fails (per
 *     `matchRegion`'s own "province known, no spec matches -> fail" rule),
 *     with zero rule evaluation needed for that (usually large) majority;
 *     only entries that DO mention the matching province get a precise
 *     `evaluateRule` check (for a possible city-level mismatch).
 *
 * Every one of these indexes is used ONLY to narrow down which entries get
 * a real `evaluateRule` call — the actual pass/fail *decision* always goes
 * through the same `evaluateRule` (imported, never reimplemented) used by
 * the old full scan and by the final rule engine. That is a deliberate
 * correctness choice: the index can never itself diverge from the rule
 * engine's semantics, because it never makes the final call — it only
 * decides which (smaller) set of entries are worth asking. The one
 * exception is region's "no spec mentions this province" case, which is
 * mathematically identical to `matchRegion`'s own unconditional fail branch
 * (see the docstring above `getCandidateBenefits` for the equivalence
 * argument) and is covered by the optimized-vs-full-scan regression tests
 * in `__tests__/eligibility/candidateIndex.test.ts`.
 *
 * A dimension the profile has NO data for is skipped entirely — not even
 * its index is consulted — because every rule in that dimension can only
 * ever resolve to "unknown" (never "fail") against missing data anyway, so
 * touching it would be pure waste. This is what makes a sparse profile
 * (e.g. age only) touch dramatically fewer entries than a rich one, and is
 * the direct implementation of "verified user input reduces the search
 * space before detailed matching."
 *
 * Correctness over cleverness still applies: retrieval must be
 * conservative. A benefit is only pruned here when a rule is BOTH:
 *   1. Structurally guaranteed necessary — reachable from the eligibility
 *      root only through "all" (AND) groups, never through an "any" (OR)
 *      group, and `required: true` (see `collectNecessaryRules`).
 *   2. Definitively failing against the profile (`evaluateRule(...) ===
 *      "fail"`) — the exact same tri-state rule evaluation the full rule
 *      engine uses.
 * Anything else — missing profile data, an unresolved/ambiguous rule, a
 * rule buried inside an "any" group, an operator/value shape the index
 * doesn't know how to fast-path (routed to a small per-dimension
 * `fallback` bucket instead, see section 4 of the spec this implements),
 * or a benefit with no structured eligibility at all — is conservatively
 * KEPT as a candidate.
 */

export type IndexDimension =
  | "age"
  | "region"
  | "targetScope"
  | "income"
  | "employment"
  | "education"
  | "housing"
  | "business"
  | "other";

function classifyDimension(rule: EligibilityRule): IndexDimension {
  if (rule.field === "age") return "age";
  if (rule.operator === "region_in") return "region";
  if (rule.operator === "target_scope_in") return "targetScope";
  if (
    rule.field === "individualIncomeRange" ||
    rule.field === "householdIncomeRange" ||
    rule.field === "annualIndividualIncome" ||
    rule.field === "annualHouseholdIncome"
  ) {
    return "income";
  }
  if (rule.field === "employmentStatus" || rule.field === "smeEmployee") return "employment";
  if (rule.field === "educationStatus") return "education";
  if (rule.field === "homeowner" || rule.field === "housingType") return "housing";
  if (rule.field === "businessOwner") return "business";
  return "other";
}

/**
 * Collects every `required: true` leaf rule that is structurally guaranteed
 * necessary — i.e. every group on the path from the root to that leaf is
 * "all", never "any". Deliberately does NOT descend into "any" groups at
 * all: none of their children can be treated as individually necessary in
 * general, so skipping them can only ever under-prune (safe), never
 * mis-prune.
 */
function collectNecessaryRules(node: EligibilityRule | EligibilityRuleGroup, out: EligibilityRule[]): void {
  if (isGroup(node)) {
    if (node.type !== "all") return; // "any" (OR) group: nothing inside is individually necessary
    for (const child of node.rules) collectNecessaryRules(child, out);
    return;
  }
  if (node.required) out.push(node);
}

export interface ConstrainedEntry {
  benefit: Benefit;
  /** Verified, unconditionally-necessary rules for this benefit (see collectNecessaryRules). */
  necessaryRules: EligibilityRule[];
  dimensions: IndexDimension[];
}

// ---------------------------------------------------------------------------
// Binary-search-backed interval indexes (age, income)
// ---------------------------------------------------------------------------

interface IntervalIndexItem {
  entry: ConstrainedEntry;
  rule: EligibilityRule;
  interval: Interval;
}

interface SortedIntervalIndex {
  /** Ascending by `interval.min` (undefined treated as -Infinity). */
  byMinAsc: IntervalIndexItem[];
  /** Ascending by `interval.max` (undefined treated as +Infinity). */
  byMaxAsc: IntervalIndexItem[];
}

export interface AgeIntervalIndex extends SortedIntervalIndex {
  /**
   * Age rules whose operator this index doesn't know how to convert to an
   * `Interval` (defensive only — every age rule produced anywhere in this
   * codebase today uses "between"/"gte"/"gt"/"lte"/"lt", all of which ARE
   * convertible; this exists so a future/unexpected operator degrades to a
   * correct-but-unoptimized scan instead of silently never being checked).
   */
  fallback: ConstrainedEntry[];
}

export interface IncomeIndex {
  /** One sorted interval index per income field ("individualIncomeRange" / "householdIncomeRange" today). */
  byField: Map<string, SortedIntervalIndex>;
  fallback: ConstrainedEntry[];
}

/** Finds the smallest index `i` such that `predicate(arr[i])` is true, given `predicate` is false for some prefix and true for the rest ("partition point" binary search). */
function partitionPoint<T>(arr: T[], predicate: (item: T) => boolean): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (predicate(arr[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function buildSortedIntervalIndex(items: IntervalIndexItem[]): SortedIntervalIndex {
  const byMinAsc = [...items].sort((a, b) => (a.interval.min ?? -Infinity) - (b.interval.min ?? -Infinity));
  const byMaxAsc = [...items].sort((a, b) => (a.interval.max ?? Infinity) - (b.interval.max ?? Infinity));
  return { byMinAsc, byMaxAsc };
}

/**
 * Returns every indexed item whose interval is DEFINITELY incompatible with
 * `query` on the min or max side, using two binary searches instead of a
 * linear scan over every item. `violatesMin`/`violatesMax` must each be
 * monotonic in the interval's min/max bound for a fixed `query` (true holds
 * for both the scalar age check — see `scalarViolatesMin/Max`, mirroring
 * `compareValueToInterval` — and the range income check — see
 * `rangeViolatesMin/Max`, mirroring `compareRangeToInterval` — in
 * lib/eligibility/interval.ts).
 */
function queryIntervalFails<Q>(
  index: SortedIntervalIndex,
  query: Q,
  violatesMin: (query: Q, interval: Interval) => boolean,
  violatesMax: (query: Q, interval: Interval) => boolean
): IntervalIndexItem[] {
  // Sorted ascending by min: violatesMin is false-then-true as min grows -> failing items form a suffix.
  const minFailStart = partitionPoint(index.byMinAsc, (item) => violatesMin(query, item.interval));
  // Sorted ascending by max: violatesMax is true-then-false as max grows, i.e. "does not violate" is
  // false-then-true -> the failing items form a prefix ending where "does not violate" first becomes true.
  const maxFailEnd = partitionPoint(index.byMaxAsc, (item) => !violatesMax(query, item.interval));

  if (minFailStart >= index.byMinAsc.length && maxFailEnd <= 0) return [];

  const fails = new Set<IntervalIndexItem>();
  for (let i = minFailStart; i < index.byMinAsc.length; i++) fails.add(index.byMinAsc[i]);
  for (let i = 0; i < maxFailEnd; i++) fails.add(index.byMaxAsc[i]);
  return [...fails];
}

/** Mirrors the min-side fail condition inside `compareValueToInterval` (interval.ts). */
function scalarViolatesMin(value: number, interval: Interval): boolean {
  return interval.min !== undefined && (interval.minInclusive ? value < interval.min : value <= interval.min);
}
/** Mirrors the max-side fail condition inside `compareValueToInterval` (interval.ts). */
function scalarViolatesMax(value: number, interval: Interval): boolean {
  return interval.max !== undefined && (interval.maxInclusive ? value > interval.max : value >= interval.max);
}
/** Mirrors the min-side fail condition inside `compareRangeToInterval` (interval.ts). */
function rangeViolatesMin(userRange: { min: number; max: number }, interval: Interval): boolean {
  return interval.min !== undefined && (interval.minInclusive ? userRange.max < interval.min : userRange.max <= interval.min);
}
/** Mirrors the max-side fail condition inside `compareRangeToInterval` (interval.ts). */
function rangeViolatesMax(userRange: { min: number; max: number }, interval: Interval): boolean {
  return interval.max !== undefined && (interval.maxInclusive ? userRange.min > interval.max : userRange.min >= interval.max);
}

/** Converts an age rule's operator+value into the equivalent `Interval`, reusing interval.ts's own boundary constructors (never reimplementing the boundary math). Returns undefined for an operator this index doesn't recognize for age (see `AgeIntervalIndex.fallback`). */
function ageRuleToInterval(rule: EligibilityRule): Interval | undefined {
  const v = rule.value;
  switch (rule.operator) {
    case "between":
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
        return { min: v[0], max: v[1], minInclusive: true, maxInclusive: true };
      }
      return undefined;
    case "gte":
      return typeof v === "number" ? atLeast(v) : undefined;
    case "gt":
      return typeof v === "number" ? moreThan(v) : undefined;
    case "lte":
      return typeof v === "number" ? atMost(v) : undefined;
    case "lt":
      return typeof v === "number" ? lessThan(v) : undefined;
    default:
      return undefined;
  }
}

function isPlainNumberRange(value: unknown): value is { min: number; max: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { min?: unknown }).min === "number" &&
    typeof (value as { max?: unknown }).max === "number"
  );
}

function isIntervalShape(value: unknown): value is Interval {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Interval).minInclusive === "boolean" &&
    typeof (value as Interval).maxInclusive === "boolean"
  );
}

/**
 * Converts an income rule's operator+value into the equivalent `Interval`.
 * `range_within_interval` already carries one. `range_within`'s plain
 * `[min, max]` tuple is mathematically identical to an inclusive-inclusive
 * `Interval` — see `range_within`'s pass/fail definition in ruleEngine.ts's
 * `compare()` (`fieldValue.min >= policyMin && fieldValue.max <= policyMax`
 * -> pass, `fieldValue.max < policyMin || fieldValue.min > policyMax` ->
 * fail), which is exactly `compareRangeToInterval` with `{min: policyMin,
 * max: policyMax, minInclusive: true, maxInclusive: true}`.
 */
function incomeRuleToInterval(rule: EligibilityRule): Interval | undefined {
  if (rule.operator === "range_within_interval") {
    return isIntervalShape(rule.value) ? rule.value : undefined;
  }
  if (rule.operator === "range_within") {
    const v = rule.value;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
      return { min: v[0], max: v[1], minInclusive: true, maxInclusive: true };
    }
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Categorical (finite-domain) reverse-value indexes
// ---------------------------------------------------------------------------

export type CategoricalDimension = "employment" | "education" | "housing" | "business";

const BOOLEAN_DOMAIN: readonly (string | boolean)[] = [true, false];
const EDUCATION_DOMAIN: readonly EducationStatus[] = [
  "high_school",
  "university",
  "graduate_school",
  "graduated",
  "not_applicable",
];
const HOUSING_TYPE_DOMAIN: readonly HousingType[] = ["own", "jeonse", "monthly_rent", "living_with_family", "other"];

/** The known, finite value domain for every field an `eq` rule can target in a categorical dimension. A field absent from this table falls back to the unindexed path (see `categoricalFallback`). */
const EQ_FIELD_DOMAIN: Record<string, readonly (string | boolean)[]> = {
  homeowner: BOOLEAN_DOMAIN,
  businessOwner: BOOLEAN_DOMAIN,
  smeEmployee: BOOLEAN_DOMAIN,
  educationStatus: EDUCATION_DOMAIN,
  housingType: HOUSING_TYPE_DOMAIN,
};

/** Which top-level UserProfile fields feed each categorical dimension — used both to build reverse indexes and to know which profile fields to probe at query time. */
export const CATEGORICAL_DIMENSION_FIELDS: Record<CategoricalDimension, readonly string[]> = {
  employment: ["employmentStatus", "smeEmployee"],
  education: ["educationStatus"],
  housing: ["homeowner", "housingType"],
  business: ["businessOwner"],
};

function isStatusCompatSpec(value: unknown): value is { passValues: unknown[]; failValues: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { failValues?: unknown }).failValues) &&
    Array.isArray((value as { passValues?: unknown }).passValues)
  );
}

// ---------------------------------------------------------------------------
// Region: province-hierarchical index
// ---------------------------------------------------------------------------

export interface RegionIndex {
  /** province -> entries with at least one `region_in` spec whose province matches (could still fail on a city-level mismatch, checked precisely at query time). */
  byProvince: Map<string, ConstrainedEntry[]>;
  /** Every entry with a region rule (== constrainedByDimension.get("region")), kept alongside `byProvince` so a known user province can prove the complement definitely fails without any rule evaluation. */
  all: ConstrainedEntry[];
}

// ---------------------------------------------------------------------------
// Applicant scope (개인/가구/법인·시설·단체/소상공인)
// ---------------------------------------------------------------------------

export interface TargetScopeIndex {
  /** 법인/시설/단체-only requirements: `matchTargetScope` fails these unconditionally for any natural-person profile — see targetScope.ts. Always checked, but the bucket itself is tiny. */
  alwaysFail: ConstrainedEntry[];
  /** 소상공인-only requirements: only relevant once `businessOwner` is known. */
  businessOwnerRelevant: ConstrainedEntry[];
  /** target_scope_in rules whose value isn't a recognized TargetScope[] shape. */
  fallback: ConstrainedEntry[];
}

export interface CandidateIndex {
  builtAt: number;
  totalCount: number;
  /**
   * Benefits with zero verified necessary rules — no structured eligibility
   * at all, or every rule sits behind an "any" group, or eligibility is
   * explicitly unrestricted. These can never be safely pruned by profile
   * data alone, so they're always returned as candidates.
   */
  unconstrained: Benefit[];
  /** Benefits with >=1 verified necessary rule — checked per-request, only pruned on a definite conflict. */
  constrained: ConstrainedEntry[];
  /** Diagnostics only: how many necessary-rule extractions landed in each dimension. */
  dimensionCounts: Record<IndexDimension, number>;
  /** The same `constrained` entries grouped by dimension (an entry with rules in multiple dimensions appears under each one). Used both directly (the "other"/catch-all fallback bucket) and as the basis for the more specific indexes below. */
  constrainedByDimension: Map<IndexDimension, ConstrainedEntry[]>;
  /** Real, queryable indexes — see the module docstring above for the design. */
  ageIndex: AgeIntervalIndex;
  incomeIndex: IncomeIndex;
  regionIndex: RegionIndex;
  categoricalIndex: Map<CategoricalDimension, Map<string, ConstrainedEntry[]>>;
  categoricalFallback: Map<CategoricalDimension, ConstrainedEntry[]>;
  targetScopeIndex: TargetScopeIndex;
}

const EMPTY_DIMENSION_COUNTS: Record<IndexDimension, number> = {
  age: 0,
  region: 0,
  targetScope: 0,
  income: 0,
  employment: 0,
  education: 0,
  housing: 0,
  business: 0,
  other: 0,
};

/**
 * Builds the candidate index over the full normalized catalog. Pure,
 * synchronous, O(catalog size) — meant to run once per catalog refresh (see
 * getCachedCandidateIndex in providers/index.ts), never per request.
 */
export function buildCandidateIndex(benefits: Benefit[]): CandidateIndex {
  const unconstrained: Benefit[] = [];
  const constrained: ConstrainedEntry[] = [];
  const dimensionCounts: Record<IndexDimension, number> = { ...EMPTY_DIMENSION_COUNTS };
  const constrainedByDimension = new Map<IndexDimension, ConstrainedEntry[]>();

  const ageItems: IntervalIndexItem[] = [];
  const ageFallback: ConstrainedEntry[] = [];
  const incomeItemsByField = new Map<string, IntervalIndexItem[]>();
  const incomeFallback: ConstrainedEntry[] = [];
  const regionByProvince = new Map<string, ConstrainedEntry[]>();
  const categoricalIndex = new Map<CategoricalDimension, Map<string, ConstrainedEntry[]>>();
  const categoricalFallback = new Map<CategoricalDimension, ConstrainedEntry[]>();
  const targetScopeAlwaysFail: ConstrainedEntry[] = [];
  const targetScopeBusinessOwnerRelevant: ConstrainedEntry[] = [];
  const targetScopeFallback: ConstrainedEntry[] = [];

  function addCategorical(dim: CategoricalDimension, key: string, entry: ConstrainedEntry) {
    let byValue = categoricalIndex.get(dim);
    if (!byValue) {
      byValue = new Map();
      categoricalIndex.set(dim, byValue);
    }
    const bucket = byValue.get(key);
    if (bucket) bucket.push(entry);
    else byValue.set(key, [entry]);
  }

  function addCategoricalFallback(dim: CategoricalDimension, entry: ConstrainedEntry) {
    const bucket = categoricalFallback.get(dim);
    if (bucket) bucket.push(entry);
    else categoricalFallback.set(dim, [entry]);
  }

  for (const benefit of benefits) {
    if (!benefit.eligibility) {
      unconstrained.push(benefit);
      continue;
    }

    const necessaryRules: EligibilityRule[] = [];
    collectNecessaryRules(benefit.eligibility, necessaryRules);

    if (necessaryRules.length === 0) {
      unconstrained.push(benefit);
      continue;
    }

    const dimensions = new Set<IndexDimension>();
    for (const rule of necessaryRules) {
      const dim = classifyDimension(rule);
      dimensions.add(dim);
      dimensionCounts[dim] += 1;
    }
    const entry: ConstrainedEntry = { benefit, necessaryRules, dimensions: [...dimensions] };
    constrained.push(entry);
    for (const dim of dimensions) {
      const bucket = constrainedByDimension.get(dim);
      if (bucket) bucket.push(entry);
      else constrainedByDimension.set(dim, [entry]);
    }

    // Route each necessary rule into its specialized index, in the same pass.
    for (const rule of necessaryRules) {
      const dim = classifyDimension(rule);

      if (dim === "age") {
        const interval = ageRuleToInterval(rule);
        if (interval) ageItems.push({ entry, rule, interval });
        else ageFallback.push(entry);
        continue;
      }

      if (dim === "income") {
        const interval = incomeRuleToInterval(rule);
        if (interval) {
          const list = incomeItemsByField.get(rule.field);
          if (list) list.push({ entry, rule, interval });
          else incomeItemsByField.set(rule.field, [{ entry, rule, interval }]);
        } else {
          incomeFallback.push(entry);
        }
        continue;
      }

      if (dim === "region") {
        if (rule.operator === "region_in" && Array.isArray(rule.value)) {
          const provinces = new Set<string>();
          for (const spec of rule.value as { province?: string }[]) {
            const p = normalizeProvince(spec?.province);
            if (p) provinces.add(p);
          }
          for (const p of provinces) {
            const bucket = regionByProvince.get(p);
            if (bucket) bucket.push(entry);
            else regionByProvince.set(p, [entry]);
          }
        }
        continue;
      }

      if (dim === "targetScope") {
        if (rule.operator === "target_scope_in" && Array.isArray(rule.value)) {
          const scopes = rule.value as string[];
          if (scopes.includes("individual") || scopes.includes("household")) {
            // Never fails (matchTargetScope passes unconditionally) — no index entry needed.
          } else if (scopes.includes("small_business_owner")) {
            targetScopeBusinessOwnerRelevant.push(entry);
          } else if (scopes.includes("corporate")) {
            targetScopeAlwaysFail.push(entry);
          }
          // Empty/unrecognized scope list: matchTargetScope always resolves "unknown" -> never fails, no index needed.
        } else {
          targetScopeFallback.push(entry);
        }
        continue;
      }

      if (dim === "employment" || dim === "education" || dim === "housing" || dim === "business") {
        if (rule.operator === "eq") {
          const domain = EQ_FIELD_DOMAIN[rule.field];
          if (domain) {
            for (const v of domain) {
              if (v !== rule.value) addCategorical(dim, `${rule.field}:${String(v)}`, entry);
            }
          } else {
            addCategoricalFallback(dim, entry);
          }
        } else if (rule.operator === "status_compat" && isStatusCompatSpec(rule.value)) {
          for (const fv of rule.value.failValues) {
            addCategorical(dim, `${rule.field}:${String(fv)}`, entry);
          }
        } else {
          addCategoricalFallback(dim, entry);
        }
        continue;
      }
      // "other": intentionally left unindexed — see constrainedByDimension.get("other"),
      // the explicit conservative fallback bucket (section 4).
    }
  }

  const ageIndex: AgeIntervalIndex = { ...buildSortedIntervalIndex(ageItems), fallback: ageFallback };

  const incomeByField = new Map<string, SortedIntervalIndex>();
  for (const [field, items] of incomeItemsByField) incomeByField.set(field, buildSortedIntervalIndex(items));
  const incomeIndex: IncomeIndex = { byField: incomeByField, fallback: incomeFallback };

  const regionIndex: RegionIndex = { byProvince: regionByProvince, all: constrainedByDimension.get("region") ?? [] };

  const targetScopeIndex: TargetScopeIndex = {
    alwaysFail: targetScopeAlwaysFail,
    businessOwnerRelevant: targetScopeBusinessOwnerRelevant,
    fallback: targetScopeFallback,
  };

  return {
    builtAt: Date.now(),
    totalCount: benefits.length,
    unconstrained,
    constrained,
    dimensionCounts,
    constrainedByDimension,
    ageIndex,
    incomeIndex,
    regionIndex,
    categoricalIndex,
    categoricalFallback,
    targetScopeIndex,
  };
}

export interface CandidateRetrievalDiagnostics {
  /**
   * Number of (entry, rule) checks resolved by narrowing through an index
   * (age/income binary search, a categorical reverse-value lookup, a
   * region province match, or the applicant-scope buckets) before calling
   * `evaluateRule` — i.e. genuinely-targeted rule evaluations, bounded by
   * the profile's known dimensions rather than the whole catalog.
   */
  indexedLookupCount: number;
  /**
   * Number of entries touched WITHOUT a value-keyed index narrowing them
   * down first: the small per-dimension `fallback` buckets (rules whose
   * shape the index doesn't recognize — empty for every rule shape actually
   * produced in this codebase today), the explicit "other" catch-all
   * dimension (e.g. `childrenCount` rules), and the region "complement"
   * membership checks (cheap Set lookups, not rule evaluations — see the
   * module docstring). Exposed so retrieval never hides a remaining scan.
   */
  fallbackScanCount: number;
  /** `unconstrained.length + surviving constrained.length` — the actual candidate count returned. */
  finalCandidateCount: number;
}

function excludeIfAnyFails(
  entries: Iterable<ConstrainedEntry>,
  dim: IndexDimension,
  profile: UserProfile,
  excluded: Set<Benefit>,
  fieldFilter?: string
) {
  for (const entry of entries) {
    if (excluded.has(entry.benefit)) continue;
    for (const rule of entry.necessaryRules) {
      if (classifyDimension(rule) !== dim) continue;
      if (fieldFilter !== undefined && rule.field !== fieldFilter) continue;
      if (evaluateRule(rule, profile) === "fail") {
        excluded.add(entry.benefit);
        break;
      }
    }
  }
}

/**
 * Retrieves candidate benefits for a profile from a prebuilt index using
 * the real per-dimension indexes built by `buildCandidateIndex` (age/income
 * binary search, categorical reverse-value lookups, region province
 * hierarchy, applicant-scope buckets — see the module docstring). Every
 * dimension the profile has NO data for is skipped entirely: a rule in that
 * dimension can only ever resolve to "unknown" against missing data, never
 * "fail", so there is nothing to check. This is what makes a sparse profile
 * touch far fewer entries than a richer one.
 *
 * The only unavoidable O(constrained-size) work left is the final pass that
 * MATERIALIZES the output array (`constrained.filter(not excluded)`) — that
 * loop does a trivial `Set.has()` per entry, never a rule evaluation, and
 * its cost doesn't grow as more profile dimensions become known (unlike the
 * old full scan, whose per-entry rule-evaluation cost was constant
 * regardless of the profile). See `getCandidateBenefitsWithDiagnostics` for
 * a breakdown callers can use to verify how much real rule-evaluation work
 * a request actually did.
 *
 * The result still needs to go through the full deterministic rule engine
 * (evaluateEligibilityDetailed) for an actual status — this layer only
 * removes benefits that are verified impossible.
 */
export function getCandidateBenefits(index: CandidateIndex, profile: UserProfile): Benefit[] {
  return getCandidateBenefitsWithDiagnostics(index, profile).candidates;
}

export function getCandidateBenefitsWithDiagnostics(
  index: CandidateIndex,
  profile: UserProfile
): { candidates: Benefit[]; diagnostics: CandidateRetrievalDiagnostics } {
  const excluded = new Set<Benefit>();
  let indexedLookupCount = 0;
  let fallbackScanCount = 0;

  // --- age ---
  const age = resolveProfileField(profile, "age");
  if (typeof age === "number") {
    const fails = queryIntervalFails(index.ageIndex, age, scalarViolatesMin, scalarViolatesMax);
    indexedLookupCount += fails.length;
    for (const item of fails) {
      if (excluded.has(item.entry.benefit)) continue;
      if (evaluateRule(item.rule, profile) === "fail") excluded.add(item.entry.benefit);
    }
    fallbackScanCount += index.ageIndex.fallback.length;
    excludeIfAnyFails(index.ageIndex.fallback, "age", profile, excluded);
  }

  // --- income (per field: individualIncomeRange / householdIncomeRange) ---
  let incomeKnown = false;
  for (const [field, fieldIndex] of index.incomeIndex.byField) {
    const range = resolveProfileField(profile, field);
    if (!isPlainNumberRange(range)) continue;
    incomeKnown = true;
    const fails = queryIntervalFails(fieldIndex, range, rangeViolatesMin, rangeViolatesMax);
    indexedLookupCount += fails.length;
    for (const item of fails) {
      if (excluded.has(item.entry.benefit)) continue;
      if (evaluateRule(item.rule, profile) === "fail") excluded.add(item.entry.benefit);
    }
  }
  if (incomeKnown) {
    fallbackScanCount += index.incomeIndex.fallback.length;
    excludeIfAnyFails(index.incomeIndex.fallback, "income", profile, excluded);
  }

  // --- region ---
  const province = normalizeProvince(resolveProfileField(profile, "residence.province") as string | undefined);
  if (province) {
    const maybeMatchArr = index.regionIndex.byProvince.get(province) ?? [];
    const maybeMatch = new Set(maybeMatchArr);
    // Every region-dimension entry NOT mentioning this province at all is a definite fail
    // (matchRegion: province known, no spec matches -> "fail", unconditionally) — no rule
    // evaluation needed, just a Set membership check per entry (see CandidateRetrievalDiagnostics).
    fallbackScanCount += index.regionIndex.all.length;
    for (const entry of index.regionIndex.all) {
      if (!maybeMatch.has(entry)) excluded.add(entry.benefit);
    }
    indexedLookupCount += maybeMatchArr.length;
    excludeIfAnyFails(maybeMatchArr, "region", profile, excluded);
  }

  // --- employment / education / housing / business ---
  for (const dim of ["employment", "education", "housing", "business"] as const) {
    let dimKnown = false;
    for (const field of CATEGORICAL_DIMENSION_FIELDS[dim]) {
      const value = resolveProfileField(profile, field);
      if (value === undefined) continue;
      dimKnown = true;
      const key = `${field}:${String(value)}`;
      const candidates = index.categoricalIndex.get(dim)?.get(key) ?? [];
      indexedLookupCount += candidates.length;
      excludeIfAnyFails(candidates, dim, profile, excluded, field);
    }
    if (dimKnown) {
      const fb = index.categoricalFallback.get(dim) ?? [];
      fallbackScanCount += fb.length;
      excludeIfAnyFails(fb, dim, profile, excluded);
    }
  }

  // --- applicant scope (개인/가구/법인·시설·단체/소상공인) ---
  indexedLookupCount += index.targetScopeIndex.alwaysFail.length;
  excludeIfAnyFails(index.targetScopeIndex.alwaysFail, "targetScope", profile, excluded);
  if (resolveProfileField(profile, "businessOwner") !== undefined) {
    indexedLookupCount += index.targetScopeIndex.businessOwnerRelevant.length;
    excludeIfAnyFails(index.targetScopeIndex.businessOwnerRelevant, "targetScope", profile, excluded);
  }
  fallbackScanCount += index.targetScopeIndex.fallback.length;
  excludeIfAnyFails(index.targetScopeIndex.fallback, "targetScope", profile, excluded);

  // --- explicit conservative fallback bucket (section 4): rules that don't map to any known dimension ---
  const otherBucket = index.constrainedByDimension.get("other") ?? [];
  fallbackScanCount += otherBucket.length;
  excludeIfAnyFails(otherBucket, "other", profile, excluded);

  // --- materialize the result ---
  const candidates: Benefit[] = [...index.unconstrained];
  for (const entry of index.constrained) {
    if (!excluded.has(entry.benefit)) candidates.push(entry.benefit);
  }

  return {
    candidates,
    diagnostics: { indexedLookupCount, fallbackScanCount, finalCandidateCount: candidates.length },
  };
}

/**
 * Reference implementation kept ONLY for the optimized-vs-full-scan
 * equivalence regression tests (`__tests__/eligibility/candidateIndex.test.ts`)
 * — this is the original, pre-indexing retrieval algorithm: check every
 * necessary rule of every constrained entry via `evaluateRule`, with no
 * indexing/narrowing at all. `getCandidateBenefits` above must always
 * return the same result as this function for the same (index, profile),
 * for every profile tested — see section 11 of the spec this implements
 * ("the optimized path may under-prune but must NEVER over-prune").
 */
export function getCandidateBenefitsFullScan(index: CandidateIndex, profile: UserProfile): Benefit[] {
  const candidates: Benefit[] = [...index.unconstrained];
  for (const entry of index.constrained) {
    let definitelyFails = false;
    for (const rule of entry.necessaryRules) {
      if (evaluateRule(rule, profile) === "fail") {
        definitelyFails = true;
        break;
      }
    }
    if (!definitelyFails) candidates.push(entry.benefit);
  }
  return candidates;
}
