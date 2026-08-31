import type {
  EligibilityRule,
  EligibilityRuleGroup,
  EligibilityStatus,
  UserProfile,
} from "@/types";
import { resolveProfileField } from "./fieldResolver";

type NodeResult = "pass" | "fail" | "unknown" | "skip";

function isGroup(node: EligibilityRule | EligibilityRuleGroup): node is EligibilityRuleGroup {
  return "type" in node && (node.type === "all" || node.type === "any");
}

function compare(operator: EligibilityRule["operator"], fieldValue: unknown, ruleValue: unknown): boolean {
  switch (operator) {
    case "eq":
      return fieldValue === ruleValue;
    case "neq":
      return fieldValue !== ruleValue;
    case "in":
      return Array.isArray(ruleValue) && ruleValue.includes(fieldValue);
    case "not_in":
      return Array.isArray(ruleValue) && !ruleValue.includes(fieldValue);
    case "gte":
      return typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue >= ruleValue;
    case "lte":
      return typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue <= ruleValue;
    case "between": {
      if (typeof fieldValue !== "number" || !Array.isArray(ruleValue) || ruleValue.length !== 2) return false;
      const [min, max] = ruleValue as [number, number];
      return fieldValue >= min && fieldValue <= max;
    }
    default:
      return false;
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

  return compare(rule.operator, fieldValue, rule.value) ? "pass" : "fail";
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
 * Evaluates a benefit's eligibility rule group against a user profile.
 * A benefit with no eligibility rules is treated as open to everyone.
 */
export function evaluateEligibility(
  eligibility: EligibilityRuleGroup | undefined,
  profile: UserProfile
): EligibilityStatus {
  if (!eligibility) return "likely_eligible";
  const result = evaluateGroup(eligibility, profile);
  return NODE_RESULT_TO_STATUS[result === "skip" ? "unknown" : result];
}
