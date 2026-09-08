import type { Benefit, RuleOperator } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { normalizeProvince, type RegionSpec } from "@/lib/eligibility/region";
import { evaluateEligibilityDetailed } from "@/lib/eligibility/ruleEngine";
import { isNationwideRegionSpec, isProvinceWideRegionSpec } from "@/domain/region/regionScope";

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
 * A PASSED `age between [0, 120]` leaf is the MOIS provider's own
 * full-domain age range (see the JA0110/JA0111 audit) — it really did PASS
 * (real eligibility evidence, never touched here), but it constrains
 * nothing: every profile with a resolvable age passes it. Counting it as
 * specific "age" personalization evidence would rank a benefit with this
 * one meaningless leaf the same as one with a genuinely narrow age gate
 * (e.g. [19,34]), which is misleading. This check is intentionally exact —
 * only the literal [0,120] `between` shape on the `age` field is excluded;
 * every other age rule (any other between-range, gte/lte, or a narrower
 * range) is unaffected and still counts exactly as before.
 */
function isNonSpecificAgeLeaf(leaf: { field: string; operator: RuleOperator; value: unknown }): boolean {
  return (
    leaf.field === "age" &&
    leaf.operator === "between" &&
    Array.isArray(leaf.value) &&
    leaf.value.length === 2 &&
    leaf.value[0] === 0 &&
    leaf.value[1] === 120
  );
}

/**
 * For a PASSED `region_in` leaf, classifies whether the match came from a
 * spec naming the user's exact city, one that allows the whole province, or
 * one that (as an OR-union) is effectively nationwide/unrestricted —
 * ranking-only, mirrors (but never modifies) matchRegion()'s own pass logic.
 *
 * Checkpoint: Youth zipCd nationwide-personalization correction. A Youth
 * Center policy's `zipCd` OR-list can legitimately enumerate every current
 * city in the country (a nationwide program expressed as an explicit list
 * rather than "no region rule at all") — see `domain/region/regionScope.ts`.
 * Naively checking "does any spec in the OR-list name the user's city" would
 * wrongly call that "exact_city" personalization evidence merely because
 * the user's city happens to be one of the (every) cities listed. This
 * function asks the SEMANTIC breadth question first:
 *
 *   1. The OR-list, unioned, provably covers every current Damoa-selectable
 *      province/city -> "none" (not personalization evidence at all,
 *      regardless of which cities happen to be named).
 *   2. The OR-list provably covers the user's WHOLE current province (via an
 *      explicit province-only spec, or via enumerating every city/gu in it)
 *      -> "province", even if achieved by literally naming the user's city
 *      among many others rather than a single province-level spec.
 *   3. Otherwise, a spec directly names the user's exact city (or a
 *      subdivision-union/historical-transition completion covers them) ->
 *      "exact_city" -- a genuinely narrower, profile-specific match.
 *   4. No spec relates to the user's province at all (can only happen via
 *      the 전남광주통합특별시 cross-province merger completion, since every
 *      other PASS path requires a same-province spec) -> "province", same
 *      fallback as before this checkpoint -- preserves historical/transition
 *      ranking behavior unchanged.
 */
function regionSpecificityForLeaf(
  leaf: { operator: RuleOperator; value: unknown },
  profile: UserProfile
): RegionSpecificity | null {
  if (leaf.operator !== "region_in" || !Array.isArray(leaf.value)) return null;
  const province = normalizeProvince(profile.residence?.province);
  if (!province) return null;
  const specs = leaf.value as RegionSpec[];

  if (isNationwideRegionSpec(specs)) return "none";

  const city = profile.residence?.city?.trim();
  for (const spec of specs) {
    if (normalizeProvince(spec.province) !== province) continue;
    if (spec.city && city && spec.city.trim() === city) {
      return isProvinceWideRegionSpec(specs, province) ? "province" : "exact_city";
    }
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
 *
 * A PASSED `region_in` leaf contributes the "region" dimension ONLY when
 * `regionSpecificityForLeaf` resolves it to `"exact_city"` or `"province"` —
 * a nationwide/unrestricted OR-list (`"none"`) is real eligibility evidence
 * (the leaf really did PASS) but NOT specific personalization evidence, so
 * it must never inflate `specificDimensionCount`/`strength` (see
 * `regionSpecificityForLeaf`'s doc comment for why "the user's city is one
 * of 200+ listed cities" isn't meaningfully profile-specific).
 *
 * Mirrors the same principle: a PASSED `age between [0, 120]` leaf (the
 * MOIS provider's full-domain non-restriction, see `isNonSpecificAgeLeaf`)
 * is real eligibility evidence but not specific personalization evidence,
 * so it's excluded from `dimensionSet` the same way a nationwide region
 * leaf is. Every other dimension is unaffected and still counts
 * unconditionally, exactly as before.
 */
export function derivePersonalizationEvidence(
  passedLeaves: { field: string; operator: RuleOperator; value: unknown }[],
  profile: UserProfile
): PersonalizationEvidence {
  const dimensionSet = new Set<PersonalizationDimension>();
  let regionSpecificity: RegionSpecificity = "none";

  for (const leaf of passedLeaves) {
    const dimension = dimensionFor(leaf.field, leaf.operator);
    const spec = regionSpecificityForLeaf(leaf, profile);
    if (spec === "exact_city") regionSpecificity = "exact_city";
    else if (spec === "province" && regionSpecificity !== "exact_city") regionSpecificity = "province";

    const isNonSpecificRegion = dimension === "region" && spec !== "exact_city" && spec !== "province";
    const isNonSpecificAge = dimension === "age" && isNonSpecificAgeLeaf(leaf);
    if (!isNonSpecificRegion && !isNonSpecificAge) dimensionSet.add(dimension);
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
