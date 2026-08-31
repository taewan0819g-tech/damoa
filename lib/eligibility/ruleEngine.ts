import type {
  Benefit,
  EligibilityRule,
  EligibilityRuleGroup,
  EligibilityStatus,
  UserProfile,
} from "@/types";
import { resolveProfileField } from "./fieldResolver";
import { matchRegion, type RegionSpec } from "./region";

type NodeResult = "pass" | "fail" | "unknown" | "skip";
type CompareResult = "pass" | "fail" | "unknown";

function isGroup(node: EligibilityRule | EligibilityRuleGroup): node is EligibilityRuleGroup {
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
    case "region_in": {
      if (!Array.isArray(ruleValue)) return "fail";
      return matchRegion(fieldValue as { province?: string; city?: string } | undefined, ruleValue as RegionSpec[]);
    }
    default:
      return "fail";
  }
}

function evaluateRule(rule: EligibilityRule, profile: UserProfile): NodeResult {
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

function evaluateNode(node: EligibilityRule | EligibilityRuleGroup, profile: UserProfile): NodeResult {
  if (isGroup(node)) {
    return evaluateGroup(node, profile);
  }
  return evaluateRule(node, profile);
}

function evaluateGroup(group: EligibilityRuleGroup, profile: UserProfile): NodeResult {
  const results = group.rules.map((child) => evaluateNode(child, profile)).filter((r) => r !== "skip");

  if (group.type === "all") {
    if (results.includes("fail")) return "fail";
    if (results.includes("unknown")) return "unknown";
    return "pass";
  }

  // "any" group
  if (results.includes("pass")) return "pass";
  if (results.includes("unknown")) return "unknown";
  if (results.length === 0) return "unknown";
  return "fail";
}

const NODE_RESULT_TO_STATUS: Record<Exclude<NodeResult, "skip">, EligibilityStatus> = {
  pass: "likely_eligible",
  unknown: "unknown",
  fail: "not_eligible",
};

/**
 * Evaluates a benefit's eligibility against a user profile.
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
 * A benefit marked `eligibilityDataStatus: "incomplete"` passing only the
 * rules we DID manage to parse is not strong evidence of full eligibility —
 * we could easily be missing a disqualifying region/income/employment
 * condition. So for incomplete benefits: a definite FAIL proven from the
 * parsed rules still produces not_eligible (a rule that CAN fail on known
 * data is trustworthy evidence), but a pass (or an already-unknown result)
 * never promotes to likely_eligible — it stays unknown.
 */
export function evaluateEligibility(
  benefit: Pick<Benefit, "eligibility" | "eligibilityUnrestricted" | "eligibilityDataStatus">,
  profile: UserProfile
): EligibilityStatus {
  const isUnrestricted = benefit.eligibilityUnrestricted === true || benefit.eligibilityDataStatus === "unrestricted";

  if (!benefit.eligibility) {
    return isUnrestricted ? "likely_eligible" : "unknown";
  }

  const result = evaluateGroup(benefit.eligibility, profile);
  const normalized = result === "skip" ? "unknown" : result;

  if (benefit.eligibilityDataStatus === "incomplete") {
    return normalized === "fail" ? "not_eligible" : "unknown";
  }

  return NODE_RESULT_TO_STATUS[normalized];
}
