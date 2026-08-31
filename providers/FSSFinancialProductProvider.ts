import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { normalizeFSSProduct, type FSSRawFinancialProduct } from "@/adapters/fss/FSSAdapter";

/**
 * Skeleton for the 금융감독원(FSS) financial product API integration
 * (예금, 적금, 주택담보대출, 전세대출, 신용대출 등).
 * Not wired up yet — no network calls are made in this MVP. The API key
 * (FSS_API_KEY) must stay server-side; never expose it via NEXT_PUBLIC_*.
 */
export class FSSFinancialProductProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    // TODO:
    // Fetch deposit/savings/loan products from the FSS 금융상품 API (server-side only, using FSS_API_KEY)
    // Run raw records through FSSFinancialProductAdapter (normalizeFSSProduct)
    // Map to Benefit
    void normalizeFSSProduct;
    return [];
  }

  async getBenefit(): Promise<Benefit | null> {
    // TODO: Fetch a single financial product by id and normalize it via normalizeFSSProduct()
    return null;
  }
}

export type { FSSRawFinancialProduct };
