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
  | "target_scope_in"
  /**
   * Reference-date-aware, EXACT calendar-date comparison of a marriage
   * duration threshold (e.g. "혼인신고일로부터 1년 이내"). `field` is always
   * `"marriageDate"` (the raw ISO date, NOT a floored year count — see
   * domain/profile/marriageDuration.ts for why a floored
   * `differenceInYears` integer can silently misclassify e.g. someone
   * married 1 year 11 months as within a "1년 이내" window). `value` is a
   * `MarriageDurationSpec` (`{years, boundary}`); the resolved field value
   * must be the profile's raw `marriageDate` string. See
   * `compareMarriageDurationToThreshold` for the exact
   * subYears(referenceDate, years)-cutoff semantics per boundary word.
   */
  | "marriage_duration_within"
  /**
   * 기준중위소득 (Korean "standard median income") percentage-threshold
   * comparison, e.g. "기준중위소득 50% 이하". `field` is always
   * `"householdIncomeRange"` (documentation/dimension-classification only —
   * see `target_scope_in`'s precedent — the operator resolves BOTH
   * `householdIncomeRange` and `householdSize` from the whole profile, never
   * just the named field). `value` is a `MedianIncomeThresholdSpec` (see
   * domain/medianIncome/evaluate.ts). Never built from a literal statistical
   * median computed at request time — 기준중위소득 is a specific annually
   * re-published MOHW table figure per household size (see
   * domain/medianIncome/table.ts).
   *
   * Deliberately narrower than the general "income" concept: the production
   * parser only ever emits this operator for clauses PROVEN to reference
   * HOUSEHOLD income at a stated 기준중위소득 percentage — never 개인소득
   * (individual income), 소득인정액 (recognized income, which subtracts
   * assets/expenses and is a different number), health-insurance-premium
   * bands, or a bare qualitative "저소득층" mention. Everything else stays
   * unresolved rather than being force-fit into this operator (see
   * koreanEligibilityParser.ts's median-income classifier).
   */
  | "median_income_threshold";

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
  /**
   * Deterministic classification of why `startDate`/`endDate` are (or
   * aren't) populated. Currently only produced by the MOIS adapter from
   * 신청기한 (see lib/eligibility/extraction/moisDeadlineParser.ts):
   * "date_range" means both dates were confidently parsed; "open_ended"
   * (상시/연중/수시/채용시) and "budget_exhaustion" (예산 소진 시) mean the
   * source explicitly says there's no fixed calendar deadline, not that we
   * failed to find one; "unparsed" means the free text didn't match any
   * known shape. This never changes how `classifyApplicationState` buckets
   * the benefit (a missing endDate is still never treated as expired) — it
   * only records *why*, for debugging/future UI use. Sources that don't
   * produce this classification simply omit it.
   */
  deadlineType?: "date_range" | "open_ended" | "budget_exhaustion" | "unparsed";
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
  /**
   * Multi-value purpose tags, derived centrally by
   * domain/benefit/topics.ts's `finalizeTopics` — unlike the single legacy
   * `category` field above, a benefit can carry more than one genuine
   * purpose (e.g. "청년 창업 임대료 지원" is both `housing` and `startup`; real
   * Youth Center records with comma-joined `lclsfNm`/`mclsfNm` like
   * "일자리,교육" are genuinely both `employment` and `education`). `category`
   * remains the single highest-priority topic (see `primaryCategory`) for
   * backward compatibility — every existing single-category call site keeps
   * working unchanged. Optional only for backward compatibility with
   * benefits constructed before this field existed; every adapter-produced
   * and mock benefit sets it going forward. See
   * domain/benefit/topics.ts's `BenefitTopic` for the exact value space
   * (excludes the financial-PRODUCT-type category values — see
   * `financialFacets` below).
   */
  topics?: BenefitTopic[];
  /**
   * Specific financial-INSTRUMENT signals (deposit/savings/loan),
   * deliberately independent from `topics`/`category` (purpose) — e.g. a
   * jeonse deposit loan is `financialFacets: ["loan"]` + `topics: ["housing"]`,
   * never `asset_building`, because its purpose is housing, not wealth
   * accumulation. Fixes the dead `deposit`/`savings`/`loan` interest values
   * documented in docs/beta-personalization-audit.md §6 — see
   * domain/benefit/topics.ts's `matchesBenefitFacet`/`matchesUserInterest`,
   * the single source of truth for matching a user's selected interest
   * against a benefit.
   */
  financialFacets?: BenefitFinancialFacet[];
}

/**
 * Purpose-level tag a benefit can carry. A single benefit can carry
 * MULTIPLE topics (see `Benefit.topics`) — e.g. "청년 창업 임대료 지원" is
 * genuinely both `housing` (임대료/rent) and `startup` (창업), and real
 * Youth Center records with comma-joined `lclsfNm`/`mclsfNm` (e.g.
 * "일자리,교육", confirmed live in `/tmp/youth_lclsf_mclsf_combos.json`,
 * 50 records) are genuinely both `employment` and `education`. Reuses
 * `BenefitCategory`'s value space minus the financial-PRODUCT-type values
 * (see `BenefitFinancialFacet`) — no real MOIS/Youth Center government
 * benefit IS itself literally "a deposit account"; those three values only
 * ever apply to the bank/savings-bank financial-product data (MOIS/Youth
 * benefits instead surface a deposit/savings/loan INSTRUMENT signal, if
 * any, via `financialFacets`). `Benefit.category` remains the single
 * highest-priority topic for backward compatibility — see
 * domain/benefit/topics.ts's `primaryCategory`.
 */
export type BenefitTopic = Exclude<BenefitCategory, "deposit" | "savings" | "loan" | "other">;

/**
 * Specific financial-INSTRUMENT signals — deliberately independent from
 * `topics`/`category` (purpose). A 전세자금대출 (jeonse deposit loan) is
 * `financialFacets: ["loan"]` + `topics: ["housing"]`, never `asset_building`
 * as a topic, because its PURPOSE is housing, not wealth accumulation —
 * confirmed live: MOIS/Youth records containing "대출"/"융자" are
 * overwhelmingly housing (전세자금/주택자금) or education (학자금) loans, not
 * generic asset-building products (see
 * docs/beta-personalization-audit.md §4/§6). Fixes the dead
 * `deposit`/`savings`/`loan` interest values from §6 — no MOIS/Youth
 * `category` ever produces them, so a user selecting one previously got
 * zero interest-match benefit for the rest of their session.
 */
export type BenefitFinancialFacet = "deposit" | "savings" | "loan";

export type EligibilityStatus = "likely_eligible" | "unknown" | "not_eligible";

export interface BenefitMatchResult {
  benefitId: string;
  status: EligibilityStatus;
}
