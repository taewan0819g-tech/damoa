import type { Benefit, EligibilityRule, EligibilityRuleGroup, UserProfile } from "@/types";
import { evaluateRule, isGroup } from "./ruleEngine";

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
 * still warm), then reuse it for every personalized request. Candidate
 * retrieval only has to look at the (usually much smaller) set of benefits
 * that have at least one *verified, unconditionally necessary* rule, plus a
 * cheap tri-state check per such rule — never the full nested rule tree.
 *
 * Correctness over cleverness: retrieval must be conservative. A benefit is
 * only pruned here when a rule is BOTH:
 *   1. Structurally guaranteed necessary — reachable from the eligibility
 *      root only through "all" (AND) groups, never through an "any" (OR)
 *      group (a rule inside an OR is never individually required, since an
 *      alternative branch could still satisfy the benefit), and
 *      `required: true`.
 *   2. Definitively failing against the profile (`evaluateRule(...) ===
 *      "fail"`) — the exact same tri-state rule evaluation the full rule
 *      engine uses, so retrieval semantics can never drift from it.
 * Anything else — missing profile data, an unresolved/ambiguous rule, a
 * rule buried inside an "any" group, or a benefit with no structured
 * eligibility at all — is conservatively KEPT as a candidate. Positive
 * relevance (should this candidate actually be shown as "likely eligible"
 * or a genuinely evidenced "unknown"?) is decided afterward by the full
 * rule engine + `isRelevantForFeed` — this layer only ever removes
 * definite, verified non-matches, it never decides who's a good match.
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
  /**
   * Section 18: the same `constrained` entries, additionally grouped by
   * dimension (an entry with rules in multiple dimensions appears under each
   * one). Built once per index build, alongside `constrained` — not a
   * replacement for it. This is scaffolding toward dimension-scoped
   * retrieval (e.g. "only re-check candidates that have an income rule when
   * only income changed") for a future caller; `getCandidateBenefits` below
   * deliberately does NOT use this yet and keeps scanning every necessary
   * rule on every constrained entry, because correctness (never pruning on
   * an unrelated dimension's stale conclusion) matters far more than the
   * marginal speedup at current catalog scale. Exposed so it doesn't need a
   * second O(catalog) pass to introduce later.
   */
  constrainedByDimension: Map<IndexDimension, ConstrainedEntry[]>;
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
  }

  return {
    builtAt: Date.now(),
    totalCount: benefits.length,
    unconstrained,
    constrained,
    dimensionCounts,
    constrainedByDimension,
  };
}

/**
 * Retrieves candidate benefits for a profile from a prebuilt index: every
 * unconstrained benefit, plus every constrained benefit whose necessary
 * rules don't definitively fail. This is the ONLY per-request cost of
 * candidate retrieval — no rebuilding, no re-fetching, no full rule-tree
 * walk. The result still needs to go through the full deterministic rule
 * engine (evaluateEligibilityDetailed) for an actual status — this layer
 * only removes benefits that are verified impossible.
 */
export function getCandidateBenefits(index: CandidateIndex, profile: UserProfile): Benefit[] {
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
