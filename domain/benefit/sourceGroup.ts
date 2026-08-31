import type { Benefit, BenefitSourceType } from "@/types/benefit";

export type BenefitSourceGroup = "government" | "youth" | "financial";

const FINANCIAL_SOURCE_TYPES: BenefitSourceType[] = [
  "bank",
  "savings_bank",
  "financial_institution",
  "card",
  "insurance",
  "securities",
];

/** Buckets a benefit's source into the three top-level tabs the UI filters by. */
export function getSourceGroup(benefit: Benefit): BenefitSourceGroup {
  if (benefit.source.type === "youth_policy") return "youth";
  if (FINANCIAL_SOURCE_TYPES.includes(benefit.source.type)) return "financial";
  return "government";
}
