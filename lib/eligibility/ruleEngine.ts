import type {
  Benefit,
  EligibilityRule,
  EligibilityRuleGroup,
  EligibilityStatus,
  UserProfile,
} from "@/types";
import { resolveProfileField } from "./fieldResolver";
import { matchRegion, type RegionSpec } from "./region";
import { matchTargetScope, type TargetScope } from "./targetScope";
import { compareRangeToInterval, isInterval } from "./interval";
import { matchStatusCompat, type StatusCompatSpec } from "./employment";
import { compareMarriageDurationToThreshold, type MarriageDurationSpec } from "@/domain/profile/marriageDuration";
import {
  compareHouseholdIncomeToMedianIncomeThreshold,
  type MedianIncomeThresholdSpec,
} from "@/domain/medianIncome/evaluate";

export type NodeResult = "pass" | "fail" | "unknown" | "skip";
type CompareResult = "pass" | "fail" | "unknown";

export function isGroup(node: EligibilityRule | EligibilityRuleGroup): node is EligibilityRuleGroup {
  return "type" in node && (node.type === "all" || node.type === "any");
}

function isRangeValue(value: unknown): value is { min: number; max: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { min?: unknown }).min === "number" &&
    typeof (value as { max?: unknown }).max === "number"
  );
}

/**
 * Compares a resolved profile field against a rule's expected value.
 * Returns a tri-state result rather than a boolean: most operators only
 * ever produce "pass"/"fail" (matching the original behavior exactly), but
 * `range_within` and `region_in` can legitimately produce "unknown" when
 * the profile data only partially overlaps/identifies the target — a
 * signal the caller (evaluateRule) treats the same as a missing required
 * field.
 */
function compare(operator: EligibilityRule["operator"], fieldValue: unknown, ruleValue: unknown): CompareResult {
  switch (operator) {
    case "eq":
      return fieldValue === ruleValue ? "pass" : "fail";
    case "neq":
      return fieldValue !== ruleValue ? "pass" : "fail";
    case "in":
      return Array.isArray(ruleValue) && ruleValue.includes(fieldValue) ? "pass" : "fail";
    case "not_in":
      return Array.isArray(ruleValue) && !ruleValue.includes(fieldValue) ? "pass" : "fail";
    case "gt":
      return typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue > ruleValue
        ? "pass"
        : "fail";
    case "lt":
      return typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue < ruleValue
        ? "pass"
        : "fail";
    case "gte":
      return typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue >= ruleValue
        ? "pass"
        : "fail";
    case "lte":
      return typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue <= ruleValue
        ? "pass"
        : "fail";
    case "between": {
      if (typeof fieldValue !== "number" || !Array.isArray(ruleValue) || ruleValue.length !== 2) return "fail";
      const [min, max] = ruleValue as [number, number];
      return fieldValue >= min && fieldValue <= max ? "pass" : "fail";
    }
    case "range_within": {
      if (!isRangeValue(fieldValue) || !Array.isArray(ruleValue) || ruleValue.length !== 2) return "fail";
      const [policyMin, policyMax] = ruleValue as [number, number];
      if (fieldValue.max < policyMin || fieldValue.min > policyMax) return "fail";
      if (fieldValue.min >= policyMin && fieldValue.max <= policyMax) return "pass";
      return "unknown";
    }
    case "range_within_interval": {
      if (!isRangeValue(fieldValue) || !isInterval(ruleValue)) return "fail";
      return compareRangeToInterval(fieldValue, ruleValue);
    }
    case "region_in": {
      if (!Array.isArray(ruleValue)) return "fail";
      return matchRegion(fieldValue as { province?: string; city?: string } | undefined, ruleValue as RegionSpec[]);
    }
    case "status_compat": {
      if (typeof ruleValue !== "object" || ruleValue === null) return "fail";
      return matchStatusCompat(fieldValue, ruleValue as StatusCompatSpec);
    }
    case "marriage_duration_within": {
      if (typeof fieldValue !== "string" || typeof ruleValue !== "object" || ruleValue === null) return "fail";
      return compareMarriageDurationToThreshold(fieldValue, ruleValue as MarriageDurationSpec);
    }
    default:
      return "fail";
  }
}

/**
 * Exported for reuse by the candidate-retrieval index (see
 * lib/eligibility/candidateIndex.ts), which needs to test a single
 * `required: true` rule against a profile without walking a whole
 * eligibility tree — e.g. to conservatively prune a benefit only when a
 * verified necessary rule definitively fails. Keeping this as the single
 * source of truth for rule-level semantics (tri-state, target_scope_in
 * handling, missing-field-as-unknown, etc.) avoids the candidate index
 * silently drifting from the real rule engine's behavior.
 */
export function evaluateRule(rule: EligibilityRule, profile: UserProfile): NodeResult {
  // target_scope_in ignores `field` and is evaluated against the whole
  // profile (see RuleEvidence / TargetScope docs) — it never resolves a
  // profile field, so it must be handled before the generic fieldValue path.
  if (rule.operator === "target_scope_in") {
    if (!Array.isArray(rule.value)) return rule.required ? "unknown" : "skip";
    const result = matchTargetScope(profile, rule.value as TargetScope[]);
    if (result === "unknown") return rule.required ? "unknown" : "skip";
    return result;
  }

  // median_income_threshold ignores `field` and is evaluated against the
  // whole profile (needs BOTH householdIncomeRange and householdSize) — see
  // RuleEvidence / MedianIncomeThresholdSpec docs, same precedent as
  // target_scope_in above.
  if (rule.operator === "median_income_threshold") {
    if (typeof rule.value !== "object" || rule.value === null) return rule.required ? "unknown" : "skip";
    const result = compareHouseholdIncomeToMedianIncomeThreshold(profile, rule.value as MedianIncomeThresholdSpec);
    if (result === "unknown") return rule.required ? "unknown" : "skip";
    return result;
  }

  const fieldValue = resolveProfileField(profile, rule.field);

  if (rule.operator === "exists") {
    const exists = fieldValue !== undefined && fieldValue !== null && fieldValue !== "";
    const expected = rule.value !== false;
    return exists === expected ? "pass" : "fail";
  }

  if (fieldValue === undefined || fieldValue === null) {
    return rule.required ? "unknown" : "skip";
  }

  const result = compare(rule.operator, fieldValue, rule.value);
  if (result === "unknown") return rule.required ? "unknown" : "skip";
  return result;
}

/**
 * A single evaluated rule leaf (never a group's aggregate), paired with the
 * originating rule so callers can inspect which field/operator/value
 * produced a PASS — used by `derivePersonalizationEvidence` (see
 * domain/benefit/personalization.ts) to classify ranking-only
 * personalization evidence. Never used to alter the tri-state
 * pass/fail/unknown status logic below.
 */
export interface LeafRecord {
  rule: EligibilityRule;
  result: NodeResult;
}

/**
 * Result of evaluating one tree node for BOTH status (`result`, mirrors the
 * pre-existing tri-state logic exactly, unchanged) and personalization
 * evidence (`evidenceLeaves`, branch-aware — see `evaluateGroup`'s "any"
 * handling below). Computed together in one traversal so evidence
 * collection never costs a second walk of the tree.
 */
interface NodeEval {
  result: NodeResult;
  /**
   * PASS leaves eligible to count as personalization evidence FROM THIS
   * SUBTREE ONLY. Deliberately narrower than "every leaf under this node
   * that happened to pass" — see the "any" branch-aware filtering below,
   * which is the whole reason this is tracked separately from the flat
   * `leaves` accumulator (which still records every leaf unconditionally,
   * for `passedRules`/`failedRules`/`hasEvidence`/`hasPositiveEvidence`,
   * completely unchanged from before).
   */
  evidenceLeaves: EligibilityRule[];
}

/**
 * `leaves` accumulates every individual rule's result (never a group's
 * aggregate), across the whole tree, in evaluation order — used by
 * `evaluateEligibilityDetailed` to compute status-adjacent diagnostics
 * (`passedRules`/`failedRules`/`hasEvidence`/`hasPositiveEvidence`) without
 * a second traversal. Untouched by the branch-aware evidence filtering
 * below — those counts intentionally still count every leaf regardless of
 * which "any" branch it lived in (see their docs on `EligibilityDiagnostics`
 * — a leaf that only ever failed inside an unresolved "any" branch is still
 * "evidence" in the `hasEvidence` sense).
 */
function evaluateNode(node: EligibilityRule | EligibilityRuleGroup, profile: UserProfile, leaves: LeafRecord[]): NodeEval {
  if (isGroup(node)) {
    return evaluateGroup(node, profile, leaves);
  }
  const result = evaluateRule(node, profile);
  leaves.push({ rule: node, result });
  return { result, evidenceLeaves: result === "pass" ? [node] : [] };
}

function evaluateGroup(group: EligibilityRuleGroup, profile: UserProfile, leaves: LeafRecord[]): NodeEval {
  const childEvals = group.rules.map((child) => evaluateNode(child, profile, leaves));
  const results = childEvals.map((c) => c.result).filter((r) => r !== "skip");

  if (group.type === "all") {
    let result: NodeResult;
    if (results.includes("fail")) result = "fail";
    else if (results.includes("unknown")) result = "unknown";
    else result = "pass";
    // "all": every child is SIMULTANEOUSLY required, never an alternative —
    // no branch ambiguity, so a child's own verified PASS is real evidence
    // about the user regardless of whether sibling requirements are
    // provable. Union every child's own evidence leaves unconditionally
    // (same as the pre-existing flat-leaves behavior for "all").
    return { result, evidenceLeaves: childEvals.flatMap((c) => c.evidenceLeaves) };
  }

  // "any" group
  let result: NodeResult;
  if (results.includes("pass")) result = "pass";
  else if (results.includes("unknown")) result = "unknown";
  else if (results.length === 0) result = "unknown";
  else result = "fail";

  // "any" children are MUTUALLY ALTERNATIVE eligibility paths — the benefit
  // only requires ONE of them, not all. Unioning PASS leaves across
  // DIFFERENT alternative branches (e.g. "age PASS + income UNKNOWN" OR
  // "region PASS + employment UNKNOWN") would fabricate combined dimension
  // coverage that no single verified path actually proves — measured and
  // documented in docs/audits/or-branch-personalization-audit.json. So only
  // a branch that ITSELF fully resolved to "pass" may contribute evidence;
  // branches that stayed unknown/fail contribute nothing, even if one of
  // their own leaves individually passed.
  //
  // Remaining edge case: if MULTIPLE alternative branches all independently
  // PASS for this user (e.g. "(age PASS) OR (region PASS)" where both
  // happen to hold), evidence must still come from exactly ONE of them —
  // otherwise unioning "age" + "region" from two independent alternative
  // paths would fabricate the same kind of combined-dimension strength this
  // whole guard exists to prevent, just via multiple-pass instead of
  // partial-pass branches. A benefit only actually required ONE alternative
  // path to hold, so only one path's evidence is real. We deterministically
  // take the FIRST passing branch (in rule-declaration order) — arbitrary
  // but stable, and simplest to reason about; there is currently no
  // production case to prefer one passing branch over another (the frozen
  // catalog has zero `any` groups — see the audit referenced above).
  const firstPassingBranch = childEvals.find((c) => c.result === "pass");
  const evidenceLeaves = firstPassingBranch ? firstPassingBranch.evidenceLeaves : [];
  return { result, evidenceLeaves };
}

const NODE_RESULT_TO_STATUS: Record<Exclude<NodeResult, "skip">, EligibilityStatus> = {
  pass: "likely_eligible",
  unknown: "unknown",
  fail: "not_eligible",
};

export type EligibilityBenefitInput = Pick<
  Benefit,
  "eligibility" | "eligibilityUnrestricted" | "eligibilityDataStatus" | "hasUnresolvedEligibility"
>;

/**
 * Internal diagnostics behind an `EligibilityStatus`, for callers that need
 * more than the tri-state result — e.g. the personalized relevance filter
 * (see domain/eligibility/matchBenefits.ts), which must distinguish an
 * "unknown" that's genuinely uninformative (zero rules ever concretely
 * compared against the profile) from an "unknown" backed by real matched
 * criteria (e.g. a benefit whose parsed rules all pass but got downgraded
 * because the source data is incomplete) — the latter is still worth
 * surfacing to the user, the former isn't.
 */
export interface EligibilityDiagnostics {
  status: EligibilityStatus;
  /** Total number of individual rule leaves considered (flattened across nested groups). */
  totalRules: number;
  /**
   * How many of those leaves resolved to a concrete pass/fail against real
   * profile data (as opposed to being skipped, or unknown for lack of data).
   */
  resolvedRules: number;
  /** How many leaves resolved to a concrete "pass" against real profile data. */
  passedRules: number;
  /** How many leaves resolved to a concrete "fail" against real profile data. */
  failedRules: number;
  /**
   * True when `resolvedRules > 0` — i.e. at least one rule was actually
   * checked against the profile (pass OR fail), not just absent data. This
   * is a DIAGNOSTIC signal only — useful for observability — and must NOT
   * be used to decide personalized relevance, because a rule that only ever
   * FAILED is "evidence" in this sense but is not a reason to show the
   * benefit to the user. See `hasPositiveEvidence` for the relevance gate.
   */
  hasEvidence: boolean;
  /**
   * True when `passedRules > 0` — i.e. at least one rule was actually
   * verified to PASS against real profile data. This is what personalized
   * relevance should gate on (see isRelevantForFeed in
   * domain/eligibility/matchBenefits.ts): "not disproven" is not the same
   * as "actually connected to this user". A benefit whose only resolved
   * rule FAILED (status still landed on "unknown" because that fail was
   * inside an "any" branch with another unresolved alternative) has
   * `hasEvidence: true` but `hasPositiveEvidence: false` — it must not be
   * recommended merely because something was checked.
   */
  hasPositiveEvidence: boolean;
  /**
   * True when every parsed rule actually passed, but the status was held at
   * "unknown" anyway because the source data is known-incomplete
   * (`eligibilityDataStatus: "incomplete"` and/or `hasUnresolvedEligibility:
   * true`) — a full pass on partial information is not full evidence.
   */
  downgradedFromPass: boolean;
  /**
   * Every leaf that resolved to a concrete "pass" against real profile
   * data, with its originating field/operator/value — ranking-only raw
   * material for `derivePersonalizationEvidence` (see
   * domain/benefit/personalization.ts). NEVER used to compute `status`
   * above, and never returned as-is from a user-facing API (see that
   * module's docs for why raw rule details must stay server-internal).
   */
  passedLeaves: { field: string; operator: EligibilityRule["operator"]; value: unknown }[];
}

/**
 * Evaluates a benefit's eligibility against a user profile and returns the
 * full diagnostic breakdown. `evaluateEligibility` below is a thin wrapper
 * over this for callers that only need the final status.
 *
 * A benefit with no structured eligibility rules is NOT assumed to be open
 * to everyone — the absence of rules usually just means the source data
 * didn't provide structured criteria, not that there are none. Such
 * benefits resolve to "unknown" unless explicitly flagged as unrestricted
 * (via `eligibilityUnrestricted: true` or `eligibilityDataStatus:
 * "unrestricted"` — set only when the source data affirmatively states
 * universal eligibility).
 *
 * "Eligibility completeness": some sources (MOIS free-text 선정기준/지원대상,
 * Youth Center's less-verified fields, etc.) very likely have MORE real
 * eligibility conditions than we've managed to turn into structured rules.
 * A benefit marked `eligibilityDataStatus: "incomplete"` OR
 * `hasUnresolvedEligibility: true` passing only the rules we DID manage to
 * parse is not strong evidence of full eligibility — we could easily be
 * missing a disqualifying region/income/employment condition (the latter
 * flag catches sources that have zero *structured* rules but a real
 * free-text clause we couldn't safely parse — still "incomplete", not
 * merely "no data"). So for incomplete benefits: a definite FAIL proven
 * from the parsed rules still produces not_eligible (a rule that CAN fail
 * on known data is trustworthy evidence), but a pass (or an already-unknown
 * result) never promotes to likely_eligible — it stays unknown.
 */
export function evaluateEligibilityDetailed(
  benefit: EligibilityBenefitInput,
  profile: UserProfile
): EligibilityDiagnostics {
  const isUnrestricted = benefit.eligibilityUnrestricted === true || benefit.eligibilityDataStatus === "unrestricted";

  if (!benefit.eligibility) {
    return {
      status: isUnrestricted ? "likely_eligible" : "unknown",
      totalRules: 0,
      resolvedRules: 0,
      passedRules: 0,
      failedRules: 0,
      hasEvidence: false,
      hasPositiveEvidence: false,
      downgradedFromPass: false,
      passedLeaves: [],
    };
  }

  const leaves: LeafRecord[] = [];
  const { result, evidenceLeaves } = evaluateGroup(benefit.eligibility, profile, leaves);
  const normalized = result === "skip" ? "unknown" : result;

  const passedRules = leaves.filter((l) => l.result === "pass").length;
  const failedRules = leaves.filter((l) => l.result === "fail").length;
  const resolvedRules = passedRules + failedRules;
  const isIncomplete = benefit.eligibilityDataStatus === "incomplete" || benefit.hasUnresolvedEligibility === true;
  const downgradedFromPass = isIncomplete && normalized === "pass";
  const status = isIncomplete ? (normalized === "fail" ? "not_eligible" : "unknown") : NODE_RESULT_TO_STATUS[normalized];
  // Branch-aware (see NodeEval/evaluateGroup docs) — NOT the same as
  // `leaves.filter(pass)` above. `passedRules`/`hasPositiveEvidence` above
  // intentionally still count every flat PASS leaf regardless of "any"
  // branch; only this ranking-only field excludes cross-branch OR unions.
  const passedLeaves = evidenceLeaves.map((rule) => ({ field: rule.field, operator: rule.operator, value: rule.value }));

  return {
    status,
    totalRules: leaves.length,
    resolvedRules,
    passedRules,
    failedRules,
    hasEvidence: resolvedRules > 0,
    hasPositiveEvidence: passedRules > 0,
    passedLeaves,
    downgradedFromPass,
  };
}

export function evaluateEligibility(benefit: EligibilityBenefitInput, profile: UserProfile): EligibilityStatus {
  return evaluateEligibilityDetailed(benefit, profile).status;
}
