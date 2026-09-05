import type { Benefit, RuleOperator } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { normalizeProvince, type RegionSpec } from "@/lib/eligibility/region";
import { evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";

/**
 * Ranking-only personalization dimensions. Distinct from eligibility: these
 * classify WHY a benefit was matched (for ordering/quality gating), never
 * whether it's eligible (that's the rule engine's `EligibilityStatus` alone).
 * Multiple UserProfile fields collapse into one real-world dimension (e.g.
 * maritalStatus/marriageDate/childrenCount/singleParentFamily/
 * multiculturalFamily/householdSize all -> "family") so a benefit with two
 * rules on the same dimension isn't double-counted as two matches.
 */
export type PersonalizationDimension =
  | "age"
  | "region"
  | "income"
  | "employment"
  | "education"
  | "housing"
  | "family"
  | "business"
  | "targetScope"
  | "other";

export type PersonalizationStrength = "strong" | "moderate" | "weak";

/** Ranking-only region signal — never used by matchRegion()/eligibility itself. */
export type RegionSpecificity = "exact_city" | "province" | "none";

export interface PersonalizationEvidence {
  /** Distinct matched dimensions from verified PASS rules only, deduped. */
  dimensions: PersonalizationDimension[];
  /** `dimensions` minus "targetScope" — targetScope is eligibility evidence but not specific personalization evidence. */
  specificDimensionCount: number;
  strength: PersonalizationStrength;
  regionSpecificity: RegionSpecificity;
}

const FIELD_DIMENSION: Partial<Record<string, PersonalizationDimension>> = {
  age: "age",
  residence: "region",
  individualIncomeRange: "income",
  householdIncomeRange: "income",
  annualIndividualIncome: "income",
  annualHouseholdIncome: "income",
  employmentStatus: "employment",
  educationStatus: "education",
  homeowner: "housing",
  housingType: "housing",
  maritalStatus: "family",
  marriageDate: "family",
  childrenCount: "family",
  singleParentFamily: "family",
  multiculturalFamily: "family",
  householdSize: "family",
  businessOwner: "business",
  smeEmployee: "business",
};

function dimensionFor(field: string, operator: RuleOperator): PersonalizationDimension {
  // target_scope_in/median_income_threshold ignore `field` entirely (see
  // ruleEngine.ts's evaluateRule) — classify by operator first, same
  // precedent the field-utilization audit already used.
  if (operator === "target_scope_in") return "targetScope";
  if (operator === "median_income_threshold") return "income";
  return FIELD_DIMENSION[field] ?? "other";
}

/**
 * For a PASSED `region_in` leaf, classifies whether the match came from a
 * spec naming the user's exact city or one that allows the whole province —
 * ranking-only, mirrors (but never modifies) matchRegion()'s own pass logic.
 */
function regionSpecificityForLeaf(
  leaf: { operator: RuleOperator; value: unknown },
  profile: UserProfile
): RegionSpecificity | null {
  if (leaf.operator !== "region_in" || !Array.isArray(leaf.value)) return null;
  const province = normalizeProvince(profile.residence?.province);
  if (!province) return null;
  const city = profile.residence?.city?.trim();
  for (const spec of leaf.value as RegionSpec[]) {
    if (normalizeProvince(spec.province) !== province) continue;
    if (spec.city && city && spec.city.trim() === city) return "exact_city";
  }
  return "province";
}

/**
 * Derives ranking-only personalization evidence from a benefit's VERIFIED
 * PASS rules only (never failed/unknown/skip leaves) — see
 * `EligibilityDiagnostics.passedLeaves` in lib/eligibility/ruleEngine.ts.
 *
 * Strength classification (deterministic, no user-interest input):
 *   STRONG   — 2+ distinct specific matched dimensions (targetScope excluded).
 *   MODERATE — exactly 1 non-age specific matched dimension.
 *   WEAK     — age-only, targetScope-only, or no specific eligibility dimension.
 *
 * User interest overlap is never consulted here, so it can never promote a
 * WEAK match into MODERATE/STRONG (see recommend.ts's comparator, which
 * only uses interest overlap as a low-priority tie-breaker after strength).
 */
export function derivePersonalizationEvidence(
  passedLeaves: { field: string; operator: RuleOperator; value: unknown }[],
  profile: UserProfile
): PersonalizationEvidence {
  const dimensionSet = new Set<PersonalizationDimension>();
  let regionSpecificity: RegionSpecificity = "none";

  for (const leaf of passedLeaves) {
    dimensionSet.add(dimensionFor(leaf.field, leaf.operator));
    const spec = regionSpecificityForLeaf(leaf, profile);
    if (spec === "exact_city") regionSpecificity = "exact_city";
    else if (spec === "province" && regionSpecificity !== "exact_city") regionSpecificity = "province";
  }

  const dimensions = [...dimensionSet];
  const specificDimensions = dimensions.filter((d) => d !== "targetScope");
  const specificDimensionCount = specificDimensions.length;

  let strength: PersonalizationStrength;
  if (specificDimensionCount >= 2) strength = "strong";
  else if (specificDimensionCount === 1 && !specificDimensions.includes("age")) strength = "moderate";
  else strength = "weak";

  return { dimensions, specificDimensionCount, strength, regionSpecificity };
}

/** Ranking priority for personalization strength — lower sorts first. */
export const STRENGTH_RANK: Record<PersonalizationStrength, number> = { strong: 0, moderate: 1, weak: 2 };

/** Ranking priority for region specificity — lower sorts first. Ranking only, never eligibility. */
export const REGION_SPECIFICITY_RANK: Record<RegionSpecificity, number> = { exact_city: 0, province: 1, none: 2 };

/**
 * Looks up precomputed evidence (e.g. from `matchBenefitsDetailed`) when
 * available, otherwise derives it on demand by re-running the rule engine
 * for just this one benefit. The fallback keeps existing/older callers
 * (that don't yet pass a precomputed map) working unchanged.
 */
export function resolvePersonalizationEvidence(
  benefit: Benefit,
  profile: UserProfile,
  evidenceById?: Map<string, PersonalizationEvidence>
): PersonalizationEvidence {
  const cached = evidenceById?.get(benefit.id);
  if (cached) return cached;
  const diag = evaluateEligibilityDetailed(benefit, profile);
  return derivePersonalizationEvidence(diag.passedLeaves, profile);
}
