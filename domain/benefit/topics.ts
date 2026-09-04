import type { Benefit, BenefitCategory, BenefitFinancialFacet, BenefitTopic } from "@/types/benefit";

export type { BenefitTopic, BenefitFinancialFacet };

/**
 * Deterministic priority used ONLY to collapse a multi-topic classification
 * down to the single legacy `Benefit.category` value every existing
 * filter/sort/UI call site still reads (see `primaryCategory`). `topics`
 * itself is never truncated or reordered by this — see `finalizeTopics`,
 * which just uses this same order for a stable, deterministic array shape.
 */
export const TOPIC_PRIORITY: readonly BenefitTopic[] = [
  "housing",
  "childcare",
  "education",
  "employment",
  "startup",
  "family",
  "transport",
  "asset_building",
  "welfare",
];

function matchAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * Genuine, specific savings/deposit/asset-formation signal words. Deliberately
 * NEVER includes the bare word "금융" ("finance") — see
 * docs/beta-personalization-audit.md §4: "금융" alone is Youth Center's own
 * combined top-level taxonomy label (`lclsfNm`: "금융·복지·문화") shared by its
 * ENTIRE welfare/health/culture supercategory, and produced 372/422 (88.2%)
 * false-positive `asset_building` tags — mental-health counseling, music/
 * culture programs, youth-day events, legal aid for loan-shark victims, none
 * of them an actual financial product. Confirmed live against the frozen
 * catalog (`/tmp/youth_policy_full.json`, `/tmp/mois_serviceList_full.json`):
 * scanning ONLY these four words (and NEVER the ambiguous umbrella field —
 * callers must exclude Youth Center's `lclsfNm` from the text passed here)
 * yields 29 Youth Center + 16 MOIS matches, EVERY one a genuine savings/
 * asset-formation program (청년내일저축계좌, 재형저축, 자산형성지원, 청년희망적금,
 * etc.) — zero observed false positives, vs. 396 + 26 under the old bare-
 * "금융" rule.
 */
const ASSET_BUILDING_WORDS = ["예금", "적금", "저축", "자산형성"] as const;
const DEPOSIT_WORDS = ["예금"] as const;
const SAVINGS_WORDS = ["적금", "저축"] as const;
/**
 * Deliberately EXCLUDED from `ASSET_BUILDING_WORDS`: a bare "대출"/"융자"
 * (loan) word is NOT genuine asset-building purpose signal on its own —
 * confirmed live that the large majority of MOIS/Youth records containing
 * these words are housing loans (전세자금/주택자금 대출이자 지원) or education
 * loans (학자금대출 이자 지원), i.e. their real topic is `housing`/`education`,
 * not `asset_building`. A loan is still surfaced via the independent `loan`
 * financial facet (see `deriveFinancialFacets`) so a user with a `loan`
 * interest can still find it — just not mis-tagged with the wrong PURPOSE.
 */
const LOAN_WORDS = ["대출", "융자"] as const;

/**
 * Whether `text` contains genuine savings/deposit/asset-formation signal —
 * the single source of truth for the `asset_building` TOPIC (purpose).
 * Callers MUST exclude any combined/ambiguous umbrella field (e.g. Youth
 * Center's `lclsfNm`) from `text` — see `ASSET_BUILDING_WORDS`'s docs.
 */
export function hasAssetBuildingSignal(text: string): boolean {
  return matchAny(text, ASSET_BUILDING_WORDS);
}

/**
 * Derives the specific financial-INSTRUMENT facets present in `text` —
 * independent from (and may disagree with) the `asset_building` topic; see
 * `BenefitFinancialFacet`'s docs for the jeonse-loan example. Same
 * umbrella-field exclusion requirement as `hasAssetBuildingSignal` applies
 * to callers passing Youth Center text.
 */
export function deriveFinancialFacets(text: string): BenefitFinancialFacet[] {
  const facets: BenefitFinancialFacet[] = [];
  if (matchAny(text, DEPOSIT_WORDS)) facets.push("deposit");
  if (matchAny(text, SAVINGS_WORDS)) facets.push("savings");
  if (matchAny(text, LOAN_WORDS)) facets.push("loan");
  return facets;
}

/** Collapses a multi-topic `Set` down to the single legacy `category` value, per `TOPIC_PRIORITY`. Defaults to `"welfare"` if `topics` is somehow empty (should never happen — see `finalizeTopics`). */
export function primaryCategory(topics: Iterable<BenefitTopic>): BenefitCategory {
  const set = new Set(topics);
  for (const t of TOPIC_PRIORITY) {
    if (set.has(t)) return t;
  }
  return "welfare";
}

/**
 * Finalizes a topic-classification pass into a stable, deterministically-
 * ordered array (per `TOPIC_PRIORITY`) — never empty: falls back to
 * `["welfare"]` when nothing matched, mirroring every existing adapter's
 * previous single-value default.
 */
export function finalizeTopics(topics: Set<BenefitTopic>): BenefitTopic[] {
  if (topics.size === 0) return ["welfare"];
  return TOPIC_PRIORITY.filter((t) => topics.has(t));
}

/**
 * Single source of truth for "does this ONE category/interest value apply
 * to this benefit" — used by both the benefits-listing category filter
 * (app/api/benefits/match/route.ts) and `matchesUserInterest` below. Checks,
 * in order:
 *   1. Direct `category` equality — preserves every existing behavior
 *      unchanged, including the FSS/mock financial-product data whose
 *      `category` IS literally `deposit`/`savings`/`loan` already.
 *   2. For the three financial-instrument values, `financialFacets`
 *      membership — the fix for docs/beta-personalization-audit.md §6 (a
 *      MOIS/Youth benefit whose primary `category` is `asset_building` but
 *      which also has a specific `savings`/`loan` facet).
 *   3. For every other value, `topics` membership — surfaces a benefit
 *      under EVERY genuine purpose it carries, not just its single primary
 *      `category` (the multi-topic fix, e.g. "청년 창업 임대료 지원" now also
 *      matches a `startup` filter/interest even though `category` is
 *      `housing`).
 * Benefits constructed before `topics`/`financialFacets` existed (e.g. not
 * yet regenerated mock/cached data) safely fall back to just the direct
 * `category` check.
 */
export function matchesBenefitFacet(benefit: Benefit, category: BenefitCategory): boolean {
  if (benefit.category === category) return true;
  if (category === "deposit" || category === "savings" || category === "loan") {
    return (benefit.financialFacets ?? []).includes(category);
  }
  return (benefit.topics ?? []).includes(category as BenefitTopic);
}

/** Whether ANY of the user's selected interests matches this benefit — see `matchesBenefitFacet`. */
export function matchesUserInterest(benefit: Benefit, interests: Iterable<BenefitCategory>): boolean {
  for (const interest of interests) {
    if (matchesBenefitFacet(benefit, interest)) return true;
  }
  return false;
}
