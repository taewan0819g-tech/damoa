export type BenefitSourceType =
  | "government"
  | "local_government"
  | "youth_policy"
  | "bank"
  | "savings_bank"
  | "financial_institution"
  | "card"
  | "insurance"
  | "securities"
  | "telecom"
  | "university"
  | "company"
  | "private"
  | "other";

export type BenefitCategory =
  | "asset_building"
  | "deposit"
  | "savings"
  | "loan"
  | "housing"
  | "employment"
  | "education"
  | "startup"
  | "family"
  | "childcare"
  | "transport"
  | "welfare"
  | "other";

export type BenefitType =
  | "cash"
  | "savings"
  | "deposit"
  | "loan"
  | "housing"
  | "discount"
  | "service"
  | "other";

export type InstitutionType =
  | "government"
  | "local_government"
  | "bank"
  | "savings_bank"
  | "financial_institution"
  | "other";

export type RuleOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "between"
  | "exists"
  /**
   * Range-vs-range containment: the resolved field value must be a
   * `{min, max}` range (e.g. an income band converted to a range). `value`
   * is the policy's own `[min, max]` range. Fully contained -> pass, no
   * overlap at all -> fail, partial overlap -> unknown (we can't prove the
   * user's actual number falls on the eligible side).
   */
  | "range_within"
  /**
   * Interval-vs-range containment using explicit boundary inclusivity
   * (see lib/eligibility/interval.ts's `Interval`). `value` is an
   * `Interval` (`{min?, max?, minInclusive, maxInclusive}`); the resolved
   * field value must be a `{min, max}` range (same shape `range_within`
   * expects). Preferred over `range_within` for any boundary derived from
   * Korean 이상/초과/이하/미만 text, because it preserves the
   * inclusive-vs-strict distinction that a plain `[min, max]` tuple can't
   * represent. Fully contained -> pass, no overlap -> fail, partial overlap
   * -> unknown.
   */
  | "range_within_interval"
  /**
   * Hierarchical Korean region matching. `value` is a `RegionSpec[]`
   * (OR'd list of `{province, city?}`; omitting `city` allows the whole
   * province). See lib/eligibility/region.ts for alias normalization.
   */
  | "region_in"
  /**
   * Small-enum applicant-status compatibility (e.g. employment status)
   * where the domain has ambiguous/unmodeled real-world values (freelancer,
   * gig work, etc.) that must resolve to "unknown" rather than being forced
   * into an exact-equality guess. `value` is `{ passValues, failValues }` —
   * two disjoint sets of known-compatible / known-incompatible values for
   * the target the rule expresses; anything not in either set is unknown.
   * See lib/eligibility/employment.ts.
   */
  | "status_compat"
  /**
   * Applicant-scope matching (개인/가구/법인·시설·단체/소상공인, verified from
   * MOIS's `사용자구분` field). `value` is a `TargetScope[]` (OR'd, mirroring
   * the source's `||`-delimited list). See lib/eligibility/targetScope.ts.
   * Ignores `field` (always evaluated against the whole profile) — kept for
   * documentation/evidence purposes only.
   */
  | "target_scope_in";

/**
 * Where a rule came from. Never expose this in end-user UI — it exists so
 * every generated rule is auditable back to a real source field/clause
 * instead of being an invented requirement (see the non-negotiable
 * principle in the eligibility spec: every rule must be traceable to a
 * verified structured field or an unambiguous deterministic text
 * extraction).
 */
export interface RuleEvidence {
  /** The raw source field/clause name, e.g. "JA0110/JA0111", "사용자구분", "지원대상". */
  sourceField: string;
  /** The exact source text the rule was extracted from, for deterministic_text extractions. */
  sourceText?: string;
  extractionType: "structured_api" | "deterministic_text";
}

export interface EligibilityRule {
  id: string;
  field: string;
  operator: RuleOperator;
  value?: unknown;
  required: boolean;
  evidence?: RuleEvidence;
}

export type EligibilityRuleGroup =
  | { type: "all"; rules: (EligibilityRule | EligibilityRuleGroup)[] }
  | { type: "any"; rules: (EligibilityRule | EligibilityRuleGroup)[] };

export interface BenefitFinancial {
  interestRate?: number;
  maxInterestRate?: number;
  loanInterestRate?: number;
  maxAmount?: number;
  minAmount?: number;
  periodMonths?: number;
  amountDescription?: string;
}

export interface BenefitApplication {
  startDate?: string;
  endDate?: string;
  officialUrl?: string;
  applicationUrl?: string;
  sourceUrl?: string;
}

export interface BenefitInstitution {
  name: string;
  type: InstitutionType;
}

export interface Benefit {
  id: string;
  title: string;
  shortDescription: string;
  category: BenefitCategory;
  source: {
    type: BenefitSourceType;
    organization: string;
    providerId?: string;
  };
  benefitType: BenefitType;
  financial?: BenefitFinancial;
  eligibility?: EligibilityRuleGroup;
  application?: BenefitApplication;
  institution?: BenefitInstitution;
  requiredDocuments?: string[];
  tags?: string[];
  updatedAt?: string;
  isDemo?: boolean;
  /**
   * Explicitly marks a benefit as open to everyone with no eligibility
   * restrictions. Only set this when the source data affirmatively states
   * universal eligibility — do NOT infer this from a benefit simply lacking
   * structured `eligibility` rules (that case should resolve to "unknown",
   * not "likely_eligible"). Equivalent to `eligibilityDataStatus: "unrestricted"`;
   * kept as its own flag for backward compatibility.
   */
  eligibilityUnrestricted?: boolean;
  /**
   * Whether the structured `eligibility` rules capture ALL of the source's
   * real eligibility conditions ("complete"), only SOME of them
   * ("incomplete" — e.g. we parsed age but the source also has an
   * unparsed region/employment/income restriction in free text),
   * or the source affirmatively states there are none ("unrestricted").
   *
   * Left undefined (or "complete") preserves the original all-pass/any-fail
   * behavior. "incomplete" changes the outcome: a benefit whose parsed rules
   * all pass is NOT promoted to likely_eligible, because there may be other
   * real requirements we never got to check — only a definite fail proven
   * from the parsed rules can produce not_eligible; everything else is
   * unknown. This is the fix for silently overclaiming eligibility on
   * partially-structured source data.
   */
  eligibilityDataStatus?: "unrestricted" | "complete" | "incomplete";
  /**
   * True when the source has at least one eligibility-bearing field/clause
   * that could NOT be safely turned into a rule (an undecoded condition
   * code, an ambiguous free-text clause, an OR'd clause our extractor can't
   * safely decompose, etc.) — independent of whether `eligibility` itself
   * has any rules at all. A benefit can have zero structured `eligibility`
   * rules yet still be `hasUnresolvedEligibility: true` (e.g. a free-text
   * 지원대상 clause too vague to parse deterministically) — that is still
   * "incomplete", not merely "no data". See lib/eligibility/ruleEngine.ts.
   */
  hasUnresolvedEligibility?: boolean;
}

export type EligibilityStatus = "likely_eligible" | "unknown" | "not_eligible";

export interface BenefitMatchResult {
  benefitId: string;
  status: EligibilityStatus;
}
