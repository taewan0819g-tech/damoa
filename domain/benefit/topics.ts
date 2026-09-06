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
 * Centralized ONLY for the two topics where MOISAdapter's and YouthAdapter's
 * keyword lists are byte-for-byte identical today (checkpoint 4
 * centralization review, docs/audits/cross-topic-precision-audit.json §5) —
 * a single source of truth removes the risk of one adapter's list drifting
 * out of sync with the other's on a future edit. housing/childcare/education/
 * employment/family are DELIBERATELY NOT centralized here: their MOIS vs.
 * Youth Center keyword lists already differ (e.g. Youth's `education` list
 * includes "직업훈련" while MOIS's `employment` list does; MOIS's `family` list
 * includes "다문화", Youth's doesn't) — real, source-specific taxonomy
 * differences the audit found and deliberately left alone rather than
 * silently merging (see the checkpoint 4 audit's §5 finding: only refactor
 * where the rule is the SAME, never to force two adapters' independent
 * judgment calls into agreement).
 */
export const STARTUP_WORDS = ["창업"] as const;
export const TRANSPORT_WORDS = ["교통"] as const;

/**
 * Whether `text` contains a genuine topic signal from `words`, EXCLUDING the
 * case where the ONLY match is `homonym` used in its unrelated, non-topic
 * sense (per `falsePositiveContextPattern` — a set of co-occurring words that
 * only show up in the false-positive sense, confirmed live against the
 * frozen catalog and verified to have ZERO overlap with genuine matches).
 * Every OTHER word in `words` always counts normally — the homonym exclusion
 * only affects `homonym` itself. See `hasChildcareSignal`/`hasHousingSignal`
 * for the two confirmed cases (checkpoint 4 cross-topic audit).
 */
function hasSignalExcludingHomonym(
  text: string,
  words: readonly string[],
  homonym: string,
  falsePositiveContextPattern: RegExp
): boolean {
  const otherWords = words.filter((w) => w !== homonym);
  if (matchAny(text, otherWords)) return true;
  if (!text.includes(homonym)) return false;
  return !falsePositiveContextPattern.test(text);
}

/**
 * "보육" (bo-yuk) is a genuine Korean homonym: "childcare" (아동보육) AND
 * "business incubation" (창업보육센터/기업보육센터 = startup/business incubator
 * center) — an unrelated meaning that has nothing to do with children.
 * Confirmed live against the frozen catalog (checkpoint 4 cross-topic audit):
 * of 45 MOIS + 8 Youth Center titles containing "보육", 4 MOIS + 7 Youth were
 * actually business-incubator programs wrongly tagged `childcare` (스마트팜
 * 청년창업 보육센터, 장애인기업 창업보육센터 운영, 완주군 창업보육센터 운영, etc.) —
 * zero of them about children. This is the SAME identical exclusion rule for
 * both adapters (word-boundary-independent substring match), so it's
 * centralized here rather than duplicated.
 */
const BUSINESS_INCUBATOR_PATTERN = /(창업보육|기업보육|비즈니스보육|보육센터)/;

/**
 * Whether `text` contains a genuine childcare signal — see
 * `hasSignalExcludingHomonym`. Non-"보육" childcare words (e.g. "육아",
 * "아동", "출산") always count normally — the incubator homonym only affects
 * "보육" itself. Callers pass their own adapter-specific `childcareWords`
 * list (MOIS's and Youth Center's differ, like every other non-centralized
 * topic — see this file's top-level centralization-review doc comment).
 */
export function hasChildcareSignal(text: string, childcareWords: readonly string[]): boolean {
  return hasSignalExcludingHomonym(text, childcareWords, "보육", BUSINESS_INCUBATOR_PATTERN);
}

/**
 * "임대" (rental/lease) genuinely means "housing rental" in most MOIS housing
 * records, but is ALSO used generically for non-residential leases —
 * farmland (농지임대), farm equipment (농기계임대), smart farms (임대형
 * 스마트팜), commercial storefronts/facilities (상가/점포/시설물 임대), vending
 * space (매점/자판기 임대) — and once even purely coincidentally, inside an
 * unrelated compound word ("퇴직예정 교직원 퇴임대비 연수": "퇴임대비" =
 * "퇴임"(retirement)+"대비"(preparation), where "임대" is just two characters
 * spanning that compound, not the leasing word at all). Confirmed live
 * against the frozen catalog (checkpoint 4 cross-topic audit): of 22 MOIS
 * housing-tagged records whose ONLY housing-word match is "임대" (no
 * "주거"/"주택"/"전세"/etc.), 17 are one of these non-residential/coincidental
 * cases. Genuine residential-lease records — 임대보증금 (rental deposit),
 * 매입임대 (purchased-rental public housing), 임시거주지 임대료 (temporary
 * residence rent) — never contain any of these context words, so this
 * exclusion has ZERO measured collateral impact on them (verified against
 * all 5 genuine 임대-only matches in the frozen catalog). Two residual,
 * lower-volume false positives (수산장비 임대 = fishery-equipment rental;
 * 외국인투자지역 임대료 지원 = foreign-investment-zone commercial rent) are
 * NOT caught by this pattern — narrower than these two singleton titles'
 * exact wording would require overfitting the pattern to just them, so
 * they're left as a documented, known residual gap rather than force-fit.
 */
const NON_RESIDENTIAL_LEASE_CONTEXT_PATTERN = /(농지|농기계|농장|스마트팜|상가|점포|시설물|사업자|자판기|매점|퇴임대비)/;

/** Whether `text` contains a genuine housing signal — see `hasSignalExcludingHomonym` and `NON_RESIDENTIAL_LEASE_CONTEXT_PATTERN`'s docs. */
export function hasHousingSignal(text: string, housingWords: readonly string[]): boolean {
  return hasSignalExcludingHomonym(text, housingWords, "임대", NON_RESIDENTIAL_LEASE_CONTEXT_PATTERN);
}

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

/**
 * Counts DISTINCT selected interests that match this benefit, via
 * `matchesBenefitFacet` (category equality, `financialFacets`, or `topics`
 * membership — same semantics `matchesUserInterest` uses, just not collapsed
 * to a boolean). Ranking evidence only — never eligibility.
 *
 * Deduplicates the `interests` input itself (a caller-supplied duplicate
 * selected interest never inflates the count), and each interest can only
 * ever contribute 1 regardless of how many ways it matches the benefit (e.g.
 * a benefit whose `category` equals "housing" AND whose `topics` also lists
 * "housing" still counts "housing" once — `matchesBenefitFacet` is a single
 * boolean check per interest, not a sum over its internal signals).
 */
export function countUserInterestOverlap(benefit: Benefit, interests: Iterable<BenefitCategory>): number {
  const distinct = new Set(interests);
  let count = 0;
  for (const interest of distinct) {
    if (matchesBenefitFacet(benefit, interest)) count += 1;
  }
  return count;
}
