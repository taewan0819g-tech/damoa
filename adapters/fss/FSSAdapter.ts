import type { Benefit, BenefitCategory, BenefitFinancialFacet, BenefitTopic } from "@/types/benefit";

/** Shape of a single raw financial product record from the 금융감독원(FSS) API. Fill in once the real schema is known. */
export interface FSSRawFinancialProduct {
  finPrdtCd: string;
  finPrdtNm: string;
  korCoNm: string;
  productType: "deposit" | "savings" | "mortgageLoan" | "jeonseLoan" | "creditLoan";
  intrRate?: number;
  intrRate2?: number;
  saveTrm?: number;
  etcNote?: string;
  [key: string]: unknown;
}

const PRODUCT_TYPE_TO_CATEGORY: Record<FSSRawFinancialProduct["productType"], BenefitCategory> = {
  deposit: "deposit",
  savings: "savings",
  mortgageLoan: "loan",
  jeonseLoan: "loan",
  creditLoan: "loan",
};

/**
 * These products' `category` already IS the exact financial-instrument
 * value (unlike MOIS/Youth, which need `financialFacets` derived
 * separately — see domain/benefit/topics.ts), so this is just a direct,
 * lossless mirror for `matchesBenefitFacet`/`matchesUserInterest` callers
 * that check `financialFacets` instead of `category`.
 */
const PRODUCT_TYPE_TO_FACET: Record<FSSRawFinancialProduct["productType"], BenefitFinancialFacet> = {
  deposit: "deposit",
  savings: "savings",
  mortgageLoan: "loan",
  jeonseLoan: "loan",
  creditLoan: "loan",
};

/**
 * `topics` (purpose) for FSS products, kept independent from `financialFacets`
 * (instrument) for the same reason MOIS/Youth loans are — see
 * domain/benefit/topics.ts. A deposit/savings account genuinely IS an
 * asset-building vehicle, so its purpose and instrument agree. A
 * mortgage/jeonse loan's PURPOSE is housing (matching MOIS/Youth's own
 * jeonse-loan-support benefits, which are tagged `topics: ["housing"]`,
 * `financialFacets: ["loan"]`) even though its instrument facet is `loan`.
 * A generic, purpose-unrestricted credit loan has no genuine purpose signal
 * at all, so it falls back to `finalizeTopics`'s empty-set default
 * (`["welfare"]`) rather than being force-fit into any of these.
 */
const PRODUCT_TYPE_TO_TOPICS: Record<FSSRawFinancialProduct["productType"], BenefitTopic[]> = {
  deposit: ["asset_building"],
  savings: ["asset_building"],
  mortgageLoan: ["housing"],
  jeonseLoan: ["housing"],
  creditLoan: ["welfare"],
};

/**
 * Normalizes a raw FSS financial product record into the app's common
 * Benefit schema. FSS raw data must never be rendered directly by UI
 * components — it always flows through this adapter first.
 */
export function normalizeFSSProduct(raw: FSSRawFinancialProduct): Benefit {
  const isLoan = raw.productType === "mortgageLoan" || raw.productType === "jeonseLoan" || raw.productType === "creditLoan";

  return {
    id: `fss-${raw.finPrdtCd}`,
    title: raw.finPrdtNm,
    shortDescription: raw.etcNote ?? `${raw.korCoNm}의 금융상품입니다.`,
    category: PRODUCT_TYPE_TO_CATEGORY[raw.productType],
    topics: PRODUCT_TYPE_TO_TOPICS[raw.productType],
    financialFacets: [PRODUCT_TYPE_TO_FACET[raw.productType]],
    source: { type: "financial_institution", organization: raw.korCoNm, providerId: raw.finPrdtCd },
    benefitType: isLoan ? "loan" : raw.productType === "deposit" ? "deposit" : "savings",
    financial: isLoan
      ? { loanInterestRate: raw.intrRate }
      : { interestRate: raw.intrRate, maxInterestRate: raw.intrRate2, periodMonths: raw.saveTrm },
    institution: { name: raw.korCoNm, type: "financial_institution" },
    isDemo: false,
  };
}
