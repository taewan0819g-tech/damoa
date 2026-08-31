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
   * Hierarchical Korean region matching. `value` is a `RegionSpec[]`
   * (OR'd list of `{province, city?}`; omitting `city` allows the whole
   * province). See lib/eligibility/region.ts for alias normalization.
   */
  | "region_in";

export interface EligibilityRule {
  id: string;
  field: string;
  operator: RuleOperator;
  value?: unknown;
  required: boolean;
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
}

export type EligibilityStatus = "likely_eligible" | "unknown" | "not_eligible";

export interface BenefitMatchResult {
  benefitId: string;
  status: EligibilityStatus;
}
