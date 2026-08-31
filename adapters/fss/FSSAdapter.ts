import type { Benefit, BenefitCategory } from "@/types/benefit";

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
    source: { type: "financial_institution", organization: raw.korCoNm, providerId: raw.finPrdtCd },
    benefitType: isLoan ? "loan" : raw.productType === "deposit" ? "deposit" : "savings",
    financial: isLoan
      ? { loanInterestRate: raw.intrRate }
      : { interestRate: raw.intrRate, maxInterestRate: raw.intrRate2, periodMonths: raw.saveTrm },
    institution: { name: raw.korCoNm, type: "financial_institution" },
    isDemo: false,
  };
}
