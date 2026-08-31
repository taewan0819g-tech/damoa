import type { Benefit } from "@/types/benefit";

/**
 * Every benefit data source (mock, government, financial) implements this
 * interface. The rest of the app only ever depends on this contract, so
 * swapping mock data for a real API later requires no UI changes.
 */
export interface BenefitProvider {
  getBenefits(): Promise<Benefit[]>;
  getBenefit(id: string): Promise<Benefit | null>;
}
