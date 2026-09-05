import type { BenefitCategory } from "@/types/benefit";

/**
 * User-selectable interest values. Measured against the frozen 13,712-item
 * MOIS + Youth Center catalog (docs/audits/cross-topic-precision-audit.json,
 * checkpoint 4):
 *
 *   - `deposit` is DELIBERATELY EXCLUDED: real coverage is 0/13712. FSS
 *     (`providers/FSSFinancialProductProvider.ts`) is not a registered
 *     production provider (see `providers/index.ts`'s `realProviders` —
 *     only MOIS/Youth Center are wired in), so no benefit in the live
 *     catalog can ever carry a `deposit` financial facet today. The
 *     `BenefitCategory`/`BenefitFinancialFacet` type value itself is kept
 *     (not removed) so this list can add it back the moment FSS becomes a
 *     real provider — see docs/beta-personalization-audit.md §6.
 *   - `savings` (36) and `loan` (488) ARE kept: both have real, if modest,
 *     current coverage via MOIS/Youth Center `financialFacets` (자산형성/적금/
 *     저축 and 대출/융자 programs), unlike `deposit`.
 *   - `family` (257: 243 MOIS + 14 Youth) is INCLUDED: material real
 *     coverage — more than `savings` — that users previously had no way to
 *     express a preference for, even though `BenefitCategory`/`BenefitTopic`
 *     has always supported it.
 */
export const INTEREST_CATEGORIES: BenefitCategory[] = [
  "asset_building",
  "savings",
  "loan",
  "housing",
  "employment",
  "education",
  "startup",
  "family",
  "childcare",
  "transport",
  "welfare",
];
