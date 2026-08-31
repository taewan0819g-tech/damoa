import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";

/**
 * Skeleton for the 온통청년(Youth Center) API integration.
 * Not wired up yet — no network calls are made in this MVP. The API key
 * (YOUTH_POLICY_API_KEY) must stay server-side; never expose it via NEXT_PUBLIC_*.
 */
export class YouthCenterBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    // TODO:
    // Fetch youth policies from the 온통청년 Open API (server-side only, using YOUTH_POLICY_API_KEY)
    // Normalize source format via normalizeYouthPolicy()
    // Map to Benefit
    void normalizeYouthPolicy;
    return [];
  }

  async getBenefit(): Promise<Benefit | null> {
    // TODO: Fetch a single youth policy by id and normalize it via normalizeYouthPolicy()
    return null;
  }
}

export type { YouthRawPolicy };
