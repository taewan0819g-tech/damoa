import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import type { ProviderHealth } from "./health";
import { mockBenefits } from "@/data/mockBenefits";
import { parseBenefitList } from "@/lib/validation/benefitSchema";

/** Simulates network latency so loading states are exercised the same way real providers will need. */
function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export class MockBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const validated = parseBenefitList(mockBenefits) as Benefit[];
    return delay(validated);
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const benefits = await this.getBenefits();
    return benefits.find((b) => b.id === id) ?? null;
  }

  /** Static in-memory data, so it's always trivially "healthy" -- reported for symmetry with the real providers. */
  getHealthStatus(): ProviderHealth {
    return {
      provider: "mock",
      configured: true,
      status: "healthy",
      lastSuccessAt: Date.now(),
      lastFailureAt: null,
      lastError: null,
      ageMs: 0,
    };
  }
}
