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
  | "exists";

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
}

export type EligibilityStatus = "likely_eligible" | "unknown" | "not_eligible";

export interface BenefitMatchResult {
  benefitId: string;
  status: EligibilityStatus;
}
