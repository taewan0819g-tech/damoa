import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { MockBenefitProvider } from "./MockBenefitProvider";

// Real sources (MOISBenefitProvider, YouthCenterBenefitProvider,
// FSSFinancialProductProvider) are intentionally not registered yet — this
// MVP only serves mock data. Add them here once their TODOs are implemented:
//
//   const providers: BenefitProvider[] = [
//     new MockBenefitProvider(),
//     new MOISBenefitProvider(),
//     new YouthCenterBenefitProvider(),
//     new FSSFinancialProductProvider(),
//   ];
const providers: BenefitProvider[] = [new MockBenefitProvider()];

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
