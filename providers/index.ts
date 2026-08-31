import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { MockBenefitProvider } from "./MockBenefitProvider";
import { MOISBenefitProvider } from "./MOISBenefitProvider";
import { YouthCenterBenefitProvider } from "./YouthCenterBenefitProvider";

// This module is only ever imported by server-side code (Route Handlers) —
// see app/api/benefits/route.ts and app/api/benefits/[id]/route.ts. Real
// providers read MOIS_API_KEY / YOUTH_POLICY_API_KEY directly from
// process.env and never expose them to the client.
//
// Real providers are registered only when their API key is actually
// configured. MockBenefitProvider is a development fallback used only when
// NO real key is configured at all — once any real key is present, mock
// data is excluded entirely so production results are never mixed with demo
// data (a provider whose key is missing/broken simply contributes 0 records
// rather than being backfilled with mock data).
const realProviders: BenefitProvider[] = [];
if (process.env.MOIS_API_KEY) realProviders.push(new MOISBenefitProvider());
if (process.env.YOUTH_POLICY_API_KEY) realProviders.push(new YouthCenterBenefitProvider());

const providers: BenefitProvider[] = realProviders.length > 0 ? realProviders : [new MockBenefitProvider()];

/** Aggregates every registered BenefitProvider into a single unified list. */
export const benefitProvider: BenefitProvider = {
  async getBenefits(): Promise<Benefit[]> {
    const results = await Promise.all(providers.map((p) => p.getBenefits()));
    return results.flat();
  },
  async getBenefit(id: string): Promise<Benefit | null> {
    for (const provider of providers) {
      const found = await provider.getBenefit(id);
      if (found) return found;
    }
    return null;
  },
};

export type { BenefitProvider };
