import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { normalizeMOISBenefit, type MOISRawBenefit } from "@/adapters/mois/MOISAdapter";

/**
 * Skeleton for the 행정안전부 공공서비스(혜택) API integration.
 * Not wired up yet — no network calls are made in this MVP. The API key
 * (MOIS_API_KEY) must stay server-side; never expose it via NEXT_PUBLIC_*.
 */
export class MOISBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    // TODO:
    // Fetch benefits from MOIS public benefit API (server-side only, using MOIS_API_KEY)
    // Normalize raw API response into Benefit schema via normalizeMOISBenefit()
    // Cache/paginate as needed
    void normalizeMOISBenefit;
    return [];
  }

  async getBenefit(): Promise<Benefit | null> {
    // TODO: Fetch a single MOIS service by id and normalize it via normalizeMOISBenefit()
    return null;
  }
}

export type { MOISRawBenefit };
