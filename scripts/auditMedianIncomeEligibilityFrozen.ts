/**
 * READ-ONLY Phase 3 (기준중위소득 / median-income) source audit against the
 * FROZEN MOIS snapshot at /tmp/mois_serviceList_full.json (10,967 rows, same
 * snapshot used for the Phase 1/Phase 2 audits). Does not call any
 * production matching/extraction code and does not modify any production
 * file — it only greps the real 지원대상/선정기준 free text around every
 * 기준중위소득 / 중위소득 mention and buckets it into semantic categories so
 * Phase 3's canonical median-income rule model can be designed FROM real
 * phrasing, not from imagination.
 *
 * Run with:
 *   npx tsx scripts/auditMedianIncomeEligibilityFrozen.ts
 *
 * Writes a full JSON report to /tmp/median-income-audit.json with the TRUE,
 * UNCAPPED per-bucket hit population (every match's serviceId/sourceField/
 * excerpt plus the extracted signal fields below) — never a capped display
 * sample. stdout stays capped to the first 10 excerpts per bucket for
 * readability only; the cap never affects the JSON report or the reported
 * counts.
 *
 * Checkpoint-3 revision (external-review correction): the first version of
 * this script's "safely comparable" figure (588/607 bucket-A hits) was too
 * broad in two ways a reviewer flagged:
 *   1. It never checked whether the income METRIC being compared against
 *      기준중위소득 was actually household income — a clause like "본인의 소득이
 *      기준중위소득 100% 이하" (individual/applicant income) or "신청인 개인소득
 *      기준중위소득 60% 이하" would have landed in bucket A (household) just
 *      because it also had a percent+boundary and wasn't 소득인정액/insurance.
 *      Fixed by adding a dedicated `incomeMetric` classification (see
 *      `INCOME_METRIC_PRIORITY` below) with its own bucket G for individual/
 *      applicant-scoped income, checked BEFORE a hit is allowed into bucket A.
 *   2. `fixedReferenceHousehold` was a boolean that only distinguished
 *      "a household-size number sits nearby" from "it doesn't" — it did NOT
 *      distinguish a genuinely fixed single reference size (safe to model as
 *      `fixed_reference_household`) from table-like text naming 2+ DIFFERENT
 *      household sizes near the same anchor (e.g. a rate table embedded in
 *      the clause), which is neither "the applicant's own household" nor
 *      "one fixed size" and must NOT be assumed safe. Fixed by replacing it
 *      with a 3-way `householdSizeMode`: "profile" (no size number nearby —
 *      scales with the applicant's own household), "fixed" (exactly one
 *      distinct size number nearby), "ambiguous" (2+ DISTINCT size numbers
 *      nearby — table-like, never assumed safe).
 * At checkpoint-3 the `safelyComparableCandidates` filter required
 * `incomeMetric === "household_income" && householdSizeMode !== "ambiguous"`
 * — narrower than the original filter, but itself superseded by the
 * checkpoint-4 revision below (which additionally drops "fixed" and
 * fraction-form hits). See the checkpoint-4 doc comment further down and the
 * printed delta trail at the bottom of this script's output for the current,
 * final filter definition.
 *
 * Checkpoint-4 revision (Phase 3 finalization, section 15): re-synced this
 * audit's "safely comparable" filter and disqualifier regexes against the
 * corrected production parser after several production-only fixes landed
 * post-checkpoint-3 that this audit had NOT yet mirrored:
 *   1. `fixed_reference_household` is no longer ever auto-inferred by
 *      production — a manual review of all 16 real "exactly one nearby
 *      household-size number" hits (docs/median-income-fixed-reference-review.md)
 *      found only 7/15 distinct services were genuinely fixed-reference, the
 *      rest being either a truncated table view or an incidental target-
 *      population size. Production now treats ANY nearby household-size
 *      number (one OR several) as unresolved. Fixed: the safe filter now
 *      requires `householdSizeMode === "profile"` exactly.
 *   2. Production added an adjacency-scoped "본인-label" disqualifier
 *      (`MEDIAN_INCOME_INDIVIDUAL_LABEL_RE`) catching phrasing like "(본인)
 *      기준중위소득 120% 이하" that general individual-income wording checks
 *      miss. Real examples 서비스ID 627000000136 and 628000000748 were
 *      previously misclassified as bucket A. Fixed: bucket G's
 *      `individualIncomeNearby` signal now also fires on this pattern.
 *   3. Production added an explicit per-household-size TABLE MARKER
 *      disqualifier (`MEDIAN_INCOME_TABLE_MARKER_RE`, real example 서비스ID
 *      641000000164). Fixed: new bucket H, checked at the same
 *      unconditional-disqualifier priority tier as insurance/소득인정액.
 *   4. Production's metric-disqualifier regex is whitespace-tolerant (real
 *      MOIS typo/spacing variants). Fixed: this audit's regexes mirror it.
 *   5. Fraction notation ("100분의 50") is explicitly, deliberately NOT
 *      extracted by production. Fixed: `safelyComparableCandidates` now
 *      excludes every fraction-form hit, reported separately.
 * Checkpoint-4's headline "safely comparable" count under that filter was
 * 565 (kept below only as `CHECKPOINT4_SAFELY_COMPARABLE_COUNT` for the
 * delta trail — it is NOT the current headline; see checkpoint-5 below).
 *
 * Checkpoint-5 revision (SECOND external-review correction — the most
 * significant one): checkpoint-4's `safelyComparableCandidates` filter was
 * STILL backwards in the way the very first version was. It required
 * `incomeMetric === "household_income"`, but `classifyIncomeMetric` assigned
 * that value to ANY hit with a parseable percent+boundary that didn't match
 * a KNOWN disqualifier (소득인정액/건강보험료/개인소득/table-marker/본인-label).
 * That is "absence of a blacklist hit", not "presence of positive evidence
 * this is actually household income" — and a follow-up empirical survey
 * (`scripts/_tmpPositiveSignalSurvey.ts`) of every real 중위소득 anchor hit in
 * this exact frozen snapshot (881 anchor hits total) found that 774/881
 * (~88%) carry NEITHER a positive household-income label (가구소득/가구원
 * 소득/세대소득 etc.) NOR any previously-known disqualifier — just a bare
 * "기준중위소득 N% 이하" with zero scoping wording either way. The same survey
 * also surfaced two entirely new disqualifier categories checkpoint-4 had no
 * bucket for at all:
 *   6. WAGE / EARNED INCOME (bucket I, new): 임금/근로소득/개인 or 근로자의
 *      월평균소득 — the applicant's own earnings, not any household-scoped
 *      figure. Real example: 서비스ID 515000000168 (청년근로자 사랑채움 사업,
 *      "임금이 2026년 기준 중위소득 150% 이하인 자") — this service was
 *      PREVIOUSLY MISCLASSIFIED as bucket A / household_income by
 *      checkpoint-4; it is correctly bucket I / wage_income as of this
 *      revision.
 *   7. COUPLE-COMBINED INCOME (bucket J, new): 부부합산(연)?소득/본인·배우자
 *      합산/신청인과 배우자의 소득 합계 — the applicant + spouse's combined
 *      income, which is not necessarily identical to full household income
 *      (a household may include other income-earning members). Real
 *      examples: 서비스ID 373000000116, 402000000115, 535000000607,
 *      519000000153.
 * Fixed: `classifyIncomeMetric` now requires an EXPLICIT positive
 * household-income signal (`HOUSEHOLD_INCOME_POSITIVE_RE`, mirroring
 * production's `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE` exactly) before
 * assigning `"household_income"` at all — a percent+boundary hit with no
 * disqualifier AND no positive signal is now its own income metric,
 * `"ambiguous_unqualified"` (bucket K, new), not silently folded into
 * `"household_income"`. `safelyComparableCandidates` is unchanged in FORM
 * (still `incomeMetric === "household_income" && householdSizeMode ===
 * "profile" && !fractionForm`) but is now dramatically narrower in practice
 * because `incomeMetric === "household_income"` itself means something
 * different (and much stricter) than it did at checkpoint-4. See the
 * "positive-evidence impact" delta trail at the bottom of this script's
 * output for the exact before/after counts.
 *
 * Production code (lib/eligibility/extraction/koreanEligibilityParser.ts's
 * `parseMedianIncomeClause`) implements this SAME priority-ordered
 * disqualifier + mandatory-positive-signal logic (건강보험료 > 소득인정액 >
 * 가구원수 테이블 마커 > 개인/본인 소득 > 임금/근로소득 > 부부합산소득 > boundary+percent
 * required > POSITIVE household-income label required > household-size-
 * number ambiguity), so this script's bucket boundaries are a direct
 * cross-check of the production parser's real-world behavior, not an
 * independent heuristic.
 */
import fs from "fs";

interface MoisRow {
  서비스ID: string;
  지원대상?: string;
  선정기준?: string;
  [key: string]: unknown;
}

const rows: MoisRow[] = JSON.parse(fs.readFileSync("/tmp/mois_serviceList_full.json", "utf-8"));
console.log(`Loaded frozen MOIS snapshot: ${rows.length} rows`);

// ---------------------------------------------------------------------------
// Anchor: a single combined regex for "기준중위소득" / "기준 중위소득" /
// "중위소득" (bare) so overlapping occurrences (e.g. "기준중위소득" containing
// the substring "중위소득") are never double-counted. Capture group 1 tells
// us whether the 기준 prefix was present.
// ---------------------------------------------------------------------------
const ANCHOR_RE = /(기준\s*)?중위\s*소득/g;

// Proximity window used for every contextual signal below. 40 chars in
// either direction — matches the excerpt padding, and was manually
// validated during the exploratory pass to comfortably cover boundary
// words, percentages, fractions, household-size parentheticals, and
// KRW amounts without pulling in unrelated clauses from unusually long
// MOIS sentences.
const WINDOW = 40;

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/;
const FRACTION_RE = /(\d{1,3})\s*분의\s*(\d{1,3})/;
const BOUNDARY_RE = /이하|미만|이상|초과/;
const YEAR_RE = /(20\d{2})\s*년/;
// Mirrors production's MEDIAN_INCOME_HOUSEHOLD_SIZE_RE (koreanEligibilityParser.ts):
// requires a 가구/가족/기준 suffix directly after "N인" so a stray "1인 이상"
// (a headcount condition, not a household-size anchor) never counts.
const HOUSEHOLD_SIZE_RE = /(\d{1,2})\s*인\s*(?:가구|가족|기준)/g;
const KRW_AMOUNT_RE = /[\d,]{4,}\s*원/;
// Checkpoint-4: widened to whitespace-tolerant, mirroring production's
// MEDIAN_INCOME_METRIC_DISQUALIFIER_RE exactly (real MOIS typo/spacing
// variants: "소득 인정액", "소득인 정액", "건 강 보험 료" — a plain literal-
// substring check misses all of these).
const SODEUK_INJEONGAEK_RE = /소득\s*인\s*정\s*액/;
const INSURANCE_RE = /건\s*강?\s*겅\s*보험\s*료|건강\s*보험\s*료|건보료/;
const CATEGORY_STATUS_RE = /기초생활수급자|수급자|차상위|기초수급/;
const MONTHLY_RE = /월\s*(?:소득|기준)|월별/;
const ANNUAL_RE = /연\s*(?:소득|소득액)/;
const OR_STRUCTURE_RE = /또는|이거나/;
const AND_STRUCTURE_RE = /그리고|이면서|이고\s/;
// Mirrors production's MEDIAN_INCOME_METRIC_DISQUALIFIERS individual-income
// entries exactly (개인소득/본인소득/본인의 소득/종합소득) — deliberately NOT
// bare "본인" (far too common/unrelated on its own, e.g. "본인 확인", "본인
// 명의") and NOT bare "신청자" (identifies WHO applies, not WHICH income
// metric is meant). Checkpoint-4: added 종합\s*소득 (종합소득, e.g. "종합소득
// 금액") to match production's disqualifier list exactly.
const INDIVIDUAL_INCOME_METRIC_RE = /개인\s*소득|본인\s*소득|본인의\s*소득|종합\s*소득/;
// Checkpoint-4 (new): mirrors production's MEDIAN_INCOME_INDIVIDUAL_LABEL_RE
// — an adjacency-scoped "(본인) 기준중위소득"/"본인 중위소득" pattern that the
// general INDIVIDUAL_INCOME_METRIC_RE above misses (it never matches bare
// "본인" without a following "소득"). Because this pattern spans across the
// anchor match itself ("...중위소득" is part of the pattern), it must be
// tested against a CONTINUOUS anchor-inclusive window, not the before+after
// `window` used everywhere else in this file — see `continuousWindow` in
// `extractSignals`. Real examples that were previously misclassified as
// bucket-A "safe household income" without this check: 서비스ID
// 627000000136 ("(본인) 기준중위소득 120% 이하") and 628000000748 ("본인 기준
// 중위소득 130%이하").
const MEDIAN_INCOME_INDIVIDUAL_LABEL_RE = /본인\s*\)?\s*(?:기준\s*)?중위\s*소득/;
// Checkpoint-4 (new): mirrors production's MEDIAN_INCOME_TABLE_MARKER_RE — an
// explicit "this varies by household size" / "per household-size table"
// marker phrase (가구원 수에 따라/가구원수별/가구 규모별) that is an
// unconditional disqualifier regardless of any percent/boundary word found
// nearby, since the actual comparable figure is impossible to resolve
// without picking the right row of an embedded table this script (and
// production) never parses. Real example: 서비스ID 641000000164 (경기도형
// 긴급복지지원, "가구원 수에 따라 기준금액 상이").
const MEDIAN_INCOME_TABLE_MARKER_RE = /가구\s*원?\s*수\s*(?:에\s*따라|별)|가구\s*규모\s*별/;
// Checkpoint-5 (new): mirrors production's
// MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE — the applicant's own individual
// earnings (임금/wage, 근로소득/earned-income tax category, or an explicit
// "개인 월평균소득"/"근로자의 월평균소득" phrasing), not any household-scoped
// figure. Real example: 서비스ID 515000000168 ("임금이 2026년 기준 중위소득 150%
// 이하인 자" — 청년근로자 사랑채움 사업). Deliberately does NOT include bare
// "급여" (routinely names a WELFARE BENEFIT TYPE in real MOIS text, e.g.
// 생계급여/의료급여/주거급여, not a wage) or bare "월평균소득" (ambiguous between
// individual and household scope without a qualifier) — both under-qualified
// forms fall through to the mandatory positive-signal requirement instead.
const MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE =
  /임금|근로\s*소득|근로자\s*의?\s*월\s*평균\s*소득|개인\s*월\s*평균\s*소득/;
// Checkpoint-5 (new): mirrors production's
// MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE — the applicant + spouse's
// COMBINED income, not necessarily identical to full household income (a
// household may also contain other income-earning members). Real examples:
// 서비스ID 373000000116, 402000000115, 535000000607, 519000000153.
const MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE =
  /부부\s*합산(?:\s*연)?\s*소득|본인\s*[·・]\s*배우자\s*합산|신청인\s*(?:과|와)?\s*배우자\s*의?\s*소득\s*합계/;
// Checkpoint-5 (new, the core fix): mirrors production's
// MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE — a POSITIVE household-scoped
// income label nearby (가구소득/가구원 소득/가구의 소득/세대소득/세대원 소득, or the
// anchor itself explicitly framed as household-unit, "가구단위 중위소득"). Like
// the 본인-label check above, this pattern can span across the anchor match
// text itself, so it's tested against `continuousWindow`, not the
// anchor-exclusive `window`.
const MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE =
  /가구(?:\s*원)?[^\n]{0,4}소득|세대(?:\s*원)?[^\n]{0,4}소득|가구\s*단위\s*(?:기준\s*)?중위\s*소득/;
const HOUSEHOLD_REF_RE = /가구|세대/;

interface Signals {
  percent?: number;
  fractionForm?: boolean; // e.g. "100분의 50"
  boundaryWord?: string;
  explicitYear?: number;
  /** Distinct household-size numbers (1-2 digit) found nearby, deduplicated — drives `householdSizeMode` below. */
  distinctHouseholdSizesNearby: number[];
  /**
   * 3-way classification replacing the old boolean `fixedReferenceHousehold`
   * (see the checkpoint-3 revision note at the top of this file):
   *  - "profile": no household-size number nearby -> scales with the
   *    applicant's own household (the common/default real-world shape).
   *  - "fixed": exactly ONE distinct household-size number nearby -> a flat
   *    reference size used for every applicant regardless of their own
   *    household.
   *  - "ambiguous": 2+ DISTINCT household-size numbers nearby (table-like
   *    text, e.g. a rate table) -> cannot safely pick a single row.
   */
  householdSizeMode: "profile" | "fixed" | "ambiguous";
  krwAmountNearby: boolean;
  sodeukInjeongaekNearby: boolean;
  insuranceNearby: boolean;
  categoryStatusNearby: boolean;
  /**
   * True if EITHER the general individual-income wording regex
   * (`INDIVIDUAL_INCOME_METRIC_RE`) OR the adjacency-scoped 본인-label regex
   * (`MEDIAN_INCOME_INDIVIDUAL_LABEL_RE`, checkpoint-4) matched. Kept as a
   * single combined signal (rather than two separate booleans) because both
   * mean the exact same thing downstream: "this is not a household-income
   * metric" — production disqualifies on either with no distinction either.
   */
  individualIncomeNearby: boolean;
  /** Checkpoint-4 (new): production's MEDIAN_INCOME_TABLE_MARKER_RE match — an unconditional per-household-size-table disqualifier, feeds bucket H. */
  tableMarkerNearby: boolean;
  /** Checkpoint-5 (new): production's MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE match — applicant's own wage/earned income, feeds bucket I. */
  wageIncomeNearby: boolean;
  /** Checkpoint-5 (new): production's MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE match — applicant+spouse combined (not full household) income, feeds bucket J. */
  coupleIncomeNearby: boolean;
  /** Checkpoint-5 (new, the core positive signal): production's MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE match — an EXPLICIT household-scoped income label nearby. Required (not merely "no disqualifier") for incomeMetric === "household_income". */
  householdIncomePositiveNearby: boolean;
  monthlyWording: boolean;
  annualWording: boolean;
  orStructure: boolean;
  andStructure: boolean;
  householdScoped: boolean;
  gijunPrefixed: boolean;
}

function extractSignals(text: string, matchIndex: number, matchLen: number): Signals {
  const start = Math.max(0, matchIndex - WINDOW);
  const end = Math.min(text.length, matchIndex + matchLen + WINDOW);
  const before = text.slice(start, matchIndex);
  const after = text.slice(matchIndex + matchLen, end);
  const window = before + after;
  // Anchor-INCLUSIVE window, needed only for regexes whose pattern spans
  // across the anchor match text itself (MEDIAN_INCOME_INDIVIDUAL_LABEL_RE
  // and, as of checkpoint-5, MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE's
  // "가구단위 중위소득" alternative — both end in / span across "중위소득").
  // Every other signal below intentionally uses the anchor-EXCLUSIVE
  // `window` above so the anchor's own "중위소득"/"기준중위소득" text never
  // accidentally satisfies an unrelated nearby-wording check.
  const continuousWindow = text.slice(start, end);

  const pctM = PERCENT_RE.exec(after) ?? PERCENT_RE.exec(before);
  const fracM = FRACTION_RE.exec(after) ?? FRACTION_RE.exec(before);
  const boundaryM = BOUNDARY_RE.exec(after);
  const yearM = YEAR_RE.exec(window);

  const sizeRe = new RegExp(HOUSEHOLD_SIZE_RE.source, "g");
  const distinctHouseholdSizesNearby = [...new Set([...window.matchAll(sizeRe)].map((m) => Number(m[1])))];
  const householdSizeMode: Signals["householdSizeMode"] =
    distinctHouseholdSizesNearby.length === 0 ? "profile" : distinctHouseholdSizesNearby.length === 1 ? "fixed" : "ambiguous";

  return {
    percent: pctM ? Number(pctM[1]) : fracM ? (Number(fracM[2]) / Number(fracM[1])) * 100 : undefined,
    fractionForm: Boolean(fracM),
    boundaryWord: boundaryM?.[0],
    explicitYear: yearM ? Number(yearM[1]) : undefined,
    distinctHouseholdSizesNearby,
    householdSizeMode,
    krwAmountNearby: KRW_AMOUNT_RE.test(window),
    sodeukInjeongaekNearby: SODEUK_INJEONGAEK_RE.test(window),
    insuranceNearby: INSURANCE_RE.test(window),
    categoryStatusNearby: CATEGORY_STATUS_RE.test(window),
    individualIncomeNearby:
      INDIVIDUAL_INCOME_METRIC_RE.test(window) || MEDIAN_INCOME_INDIVIDUAL_LABEL_RE.test(continuousWindow),
    tableMarkerNearby: MEDIAN_INCOME_TABLE_MARKER_RE.test(window),
    wageIncomeNearby: MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE.test(window),
    coupleIncomeNearby: MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE.test(window),
    householdIncomePositiveNearby: MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE.test(continuousWindow),
    monthlyWording: MONTHLY_RE.test(window),
    annualWording: ANNUAL_RE.test(window),
    orStructure: OR_STRUCTURE_RE.test(window),
    andStructure: AND_STRUCTURE_RE.test(window),
    householdScoped: HOUSEHOLD_REF_RE.test(window),
    gijunPrefixed: false, // filled in by caller (depends on match[1])
  };
}

// ---------------------------------------------------------------------------
// incomeMetric — a first-class classification independent of the A-K bucket,
// so the "safely comparable" filter and the parser cross-check can both key
// off it directly rather than reverse-engineering it from the bucket letter.
// Priority order mirrors production's parseMedianIncomeClause disqualifier
// checks exactly, ending in the checkpoint-5 mandatory positive-signal gate.
// ---------------------------------------------------------------------------
type IncomeMetric =
  | "health_insurance_premium"
  | "recognized_income"
  | "table_reference"
  | "individual_income"
  | "wage_income"
  | "couple_income"
  | "category_status"
  | "household_income"
  | "ambiguous_unqualified"
  | "ambiguous";

function classifyIncomeMetric(s: Signals): IncomeMetric {
  if (s.insuranceNearby) return "health_insurance_premium";
  if (s.sodeukInjeongaekNearby) return "recognized_income";
  // Checkpoint-4: table-marker disqualifier, checked at the same
  // unconditional-disqualifier priority tier as insurance/소득인정액 above.
  if (s.tableMarkerNearby) return "table_reference";
  if (s.individualIncomeNearby) return "individual_income";
  // Checkpoint-5 (new): wage/couple-income disqualifiers, checked before the
  // category/household branches (mirrors production's disqualifier order).
  if (s.wageIncomeNearby) return "wage_income";
  if (s.coupleIncomeNearby) return "couple_income";
  if (s.categoryStatusNearby && s.percent === undefined && !s.fractionForm) return "category_status";
  if ((s.percent !== undefined || s.fractionForm) && s.boundaryWord) {
    // Checkpoint-5 (the core fix): a parseable percent+boundary with no
    // known disqualifier is NO LONGER sufficient for "household_income" —
    // an EXPLICIT positive household-income label must also be present.
    // Without one, this is "ambiguous_unqualified", not silently assumed
    // household income.
    return s.householdIncomePositiveNearby ? "household_income" : "ambiguous_unqualified";
  }
  return "ambiguous";
}

// ---------------------------------------------------------------------------
// Semantic bucket classifier — priority-ordered per the Phase 3 spec,
// extended (checkpoint-3) with bucket G for individual/applicant-scoped
// income, (checkpoint-4) with bucket H for table markers, and (checkpoint-5)
// with buckets I/J/K for wage income, couple income, and unqualified
// ambiguous household-income-shaped hits respectively:
//   C. HEALTH-INSURANCE-PREMIUM PROXY  (checked first)
//   B. 소득인정액 THRESHOLD
//   H. PER-HOUSEHOLD-SIZE TABLE MARKER
//   G. INDIVIDUAL / APPLICANT-SCOPED INCOME
//   I. WAGE / EARNED INCOME (checkpoint-5, new)
//   J. COUPLE-COMBINED INCOME (checkpoint-5, new)
//   D. CATEGORY / STATUS REFERENCE
//   A. CONFIRMED HOUSEHOLD-INCOME THRESHOLD (percent/fraction + boundary
//      word, no disqualifier above, AND an explicit positive
//      household-income label nearby — checkpoint-5 requirement)
//   K. AMBIGUOUS / UNQUALIFIED HOUSEHOLD-INCOME-SHAPED (checkpoint-5, new:
//      percent/fraction + boundary word, no disqualifier above, but NO
//      positive household-income label either — the ~88% majority case)
//   E. DESCRIPTIVE / NON-ELIGIBILITY MENTION (no boundary word / no percent
//      structure — reads as background description, not a testable rule)
//   F. AMBIGUOUS / OTHER (fallback)
// ---------------------------------------------------------------------------
type Bucket = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";

function classify(s: Signals): Bucket {
  if (s.insuranceNearby) return "C";
  if (s.sodeukInjeongaekNearby) return "B";
  if (s.tableMarkerNearby) return "H";
  if (s.individualIncomeNearby) return "G";
  if (s.wageIncomeNearby) return "I";
  if (s.coupleIncomeNearby) return "J";
  if (s.categoryStatusNearby && s.percent === undefined && !s.fractionForm) return "D";
  if ((s.percent !== undefined || s.fractionForm) && s.boundaryWord) {
    return s.householdIncomePositiveNearby ? "A" : "K";
  }
  if (s.boundaryWord === undefined && s.percent === undefined && !s.fractionForm) return "E";
  return "F";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  A: "A. CONFIRMED HOUSEHOLD-INCOME THRESHOLD (positive signal present)",
  B: "B. 소득인정액 THRESHOLD",
  C: "C. HEALTH-INSURANCE-PREMIUM PROXY",
  D: "D. CATEGORY / STATUS REFERENCE",
  E: "E. DESCRIPTIVE / NON-ELIGIBILITY MENTION",
  F: "F. AMBIGUOUS / OTHER",
  G: "G. INDIVIDUAL / APPLICANT-SCOPED INCOME",
  H: "H. PER-HOUSEHOLD-SIZE TABLE MARKER",
  I: "I. WAGE / EARNED INCOME (individual, checkpoint-5)",
  J: "J. COUPLE-COMBINED INCOME (not full household, checkpoint-5)",
  K: "K. AMBIGUOUS/UNQUALIFIED HOUSEHOLD-INCOME-SHAPED (no positive signal, checkpoint-5)",
};

interface Hit {
  serviceId: string;
  sourceField: "지원대상" | "선정기준";
  excerpt: string;
  bucket: Bucket;
  incomeMetric: IncomeMetric;
  signals: Signals;
}

function excerptAround(text: string, index: number, len: number, pad = 40): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + len + pad);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const BUCKET_KEYS: Bucket[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
const allHits: Hit[] = [];
const bucketHits: Record<Bucket, Hit[]> = {
  A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [],
};
const bucketServiceIds: Record<Bucket, Set<string>> = {
  A: new Set(), B: new Set(), C: new Set(), D: new Set(), E: new Set(), F: new Set(),
  G: new Set(), H: new Set(), I: new Set(), J: new Set(), K: new Set(),
};
const incomeMetricCounts: Record<IncomeMetric, number> = {
  health_insurance_premium: 0,
  recognized_income: 0,
  table_reference: 0,
  individual_income: 0,
  wage_income: 0,
  couple_income: 0,
  category_status: 0,
  household_income: 0,
  ambiguous_unqualified: 0,
  ambiguous: 0,
};
const anySignalServiceIds = new Set<string>();
const percentFrequency = new Map<number, number>();
const boundaryWordFrequency = new Map<string, number>();
const yearFrequency = new Map<number, number>();
let noYearCount = 0;
const sourceFieldDistribution: Record<"지원대상" | "선정기준", number> = { 지원대상: 0, 선정기준: 0 };
const gijunPrefixedCount = { yes: 0, no: 0 };
const householdSizeModeCount = { profile: 0, fixed: 0, ambiguous: 0 };
const krwAmountCount = { yes: 0, no: 0 };
const monthlyVsAnnual = { monthly: 0, annual: 0, neither: 0 };
const orAndStructureCount = { or: 0, and: 0, neither: 0 };

for (const row of rows) {
  const fields: Array<["지원대상" | "선정기준", string | undefined]> = [
    ["지원대상", row.지원대상],
    ["선정기준", row.선정기준],
  ];
  let hitAny = false;
  for (const [field, raw] of fields) {
    if (!raw) continue;
    const re = new RegExp(ANCHOR_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const gijunPrefixed = Boolean(m[1]);
      const signals = extractSignals(raw, m.index, m[0].length);
      signals.gijunPrefixed = gijunPrefixed;
      const bucket = classify(signals);
      const incomeMetric = classifyIncomeMetric(signals);

      const hit: Hit = {
        serviceId: row.서비스ID,
        sourceField: field,
        excerpt: excerptAround(raw, m.index, m[0].length),
        bucket,
        incomeMetric,
        signals,
      };
      allHits.push(hit);
      bucketHits[bucket].push(hit);
      bucketServiceIds[bucket].add(row.서비스ID);
      incomeMetricCounts[incomeMetric]++;
      hitAny = true;

      sourceFieldDistribution[field]++;
      gijunPrefixedCount[gijunPrefixed ? "yes" : "no"]++;
      if (signals.percent !== undefined) {
        const rounded = Math.round(signals.percent);
        percentFrequency.set(rounded, (percentFrequency.get(rounded) ?? 0) + 1);
      }
      if (signals.boundaryWord) {
        boundaryWordFrequency.set(signals.boundaryWord, (boundaryWordFrequency.get(signals.boundaryWord) ?? 0) + 1);
      }
      if (signals.explicitYear !== undefined) {
        yearFrequency.set(signals.explicitYear, (yearFrequency.get(signals.explicitYear) ?? 0) + 1);
      } else {
        noYearCount++;
      }
      householdSizeModeCount[signals.householdSizeMode]++;
      krwAmountCount[signals.krwAmountNearby ? "yes" : "no"]++;
      if (signals.monthlyWording && !signals.annualWording) monthlyVsAnnual.monthly++;
      else if (signals.annualWording && !signals.monthlyWording) monthlyVsAnnual.annual++;
      else if (signals.monthlyWording && signals.annualWording) {
        // Both matched in the window — count toward whichever is closer is
        // not worth the complexity for an audit; treat as monthly since MOIS
        // median-income clauses are overwhelmingly monthly-basis in practice.
        monthlyVsAnnual.monthly++;
      } else monthlyVsAnnual.neither++;
      if (signals.orStructure && !signals.andStructure) orAndStructureCount.or++;
      else if (signals.andStructure && !signals.orStructure) orAndStructureCount.and++;
      else orAndStructureCount.neither++;
    }
  }
  if (hitAny) anySignalServiceIds.add(row.서비스ID);
}

// Checkpoint-4's headline "safely comparable" figure, kept only for the
// delta trail below (NOT the current headline — see checkpoint-5 above).
const CHECKPOINT4_SAFELY_COMPARABLE_COUNT = 565;

// "Safely comparable" subset: a hit is only a candidate for reuse against
// existing profile household-income data when ALL THREE hold:
//  - incomeMetric === "household_income" (as of checkpoint-5, this itself
//    now REQUIRES an explicit positive household-income signal nearby — see
//    `classifyIncomeMetric`. Bucket B/C/D/G/H/I/J/K are ALL excluded by
//    construction, since only bucket A ever produces this incomeMetric)
//  - householdSizeMode === "profile" EXACTLY (checkpoint-4: "fixed" is never
//    counted as safe — production never auto-infers `fixed_reference_household`
//    from text alone; see the module doc comment)
//  - !fractionForm (checkpoint-4: fraction notation is explicitly
//    unsupported by production and must never count as safely comparable)
const safelyComparableCandidates = allHits.filter(
  (h) =>
    h.incomeMetric === "household_income" &&
    h.signals.householdSizeMode === "profile" &&
    !h.signals.fractionForm
);
// Diagnostic-only counts (NOT part of the safe total):
const fixedModeExcludedCount = allHits.filter(
  (h) => h.incomeMetric === "household_income" && h.signals.householdSizeMode === "fixed"
).length;
const fractionFormSafeExcluded = allHits.filter(
  (h) => h.incomeMetric === "household_income" && h.signals.householdSizeMode === "profile" && h.signals.fractionForm
).length;
const bucketAAmbiguousHouseholdSizeCount = bucketHits.A.filter((h) => h.signals.householdSizeMode === "ambiguous").length;

// Checkpoint-5 "positive-evidence impact": how many hits that WOULD have
// counted as safely-comparable under the checkpoint-4 filter (percent +
// boundary, no known disqualifier at the time, householdSizeMode ===
// "profile", !fractionForm) are now correctly excluded solely because they
// lack an explicit positive household-income signal (i.e. they now land in
// bucket K instead of bucket A, with the same size/fraction profile).
const positiveEvidenceImpactExcludedCount = bucketHits.K.filter(
  (h) => h.signals.householdSizeMode === "profile" && !h.signals.fractionForm
).length;
const checkpoint4EquivalentSafeCount = safelyComparableCandidates.length + positiveEvidenceImpactExcludedCount;
const wageIncomeExcludedCount = bucketHits.I.length;
const coupleIncomeExcludedCount = bucketHits.J.length;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nTotal frozen MOIS records: ${rows.length}`);
console.log(`Records with median-income signal (union): ${anySignalServiceIds.size}`);
console.log(`Total anchor hits (matchCount, uncapped): ${allHits.length}`);
console.log(`Distinct service IDs with ANY median-income anchor hit: ${anySignalServiceIds.size}`);

console.log("\n=== Bucket counts (A-K) ===");
console.table(
  BUCKET_KEYS.map((b) => ({
    bucket: BUCKET_LABELS[b],
    matchCount: bucketHits[b].length,
    distinctRecords: bucketServiceIds[b].size,
  }))
);

console.log("\n=== incomeMetric distribution ===");
console.table(Object.entries(incomeMetricCounts).map(([metric, count]) => ({ metric, count })));

console.log("\n=== 기준-prefixed vs bare 중위소득 ===");
console.log(gijunPrefixedCount);

console.log("\n=== Source field distribution ===");
console.log(sourceFieldDistribution);

console.log("\n=== Percentage frequency (rounded) ===");
console.log(
  [...percentFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pct, count]) => `${pct}%: ${count}`)
    .join(", ")
);

console.log("\n=== Boundary word frequency ===");
console.log([...boundaryWordFrequency.entries()].sort((a, b) => b[1] - a[1]));

console.log("\n=== Explicit year frequency ===");
console.log([...yearFrequency.entries()].sort((a, b) => a[0] - b[0]));
console.log(`No explicit year nearby: ${noYearCount}`);

console.log("\n=== Household-size mode (3-way, checkpoint-3 REPLACES old boolean fixedReferenceHousehold) ===");
console.log({ householdSizeModeCount, bucketAAmbiguousHouseholdSizeCount });

console.log("\n=== KRW amount stated directly nearby ===");
console.log(krwAmountCount);

console.log("\n=== Monthly vs annual wording ===");
console.log(monthlyVsAnnual);

console.log("\n=== OR / AND structure ===");
console.log(orAndStructureCount);

console.log(`\n=== Safely-comparable-against-existing-householdIncomeRange candidate count (CHECKPOINT-5, FINAL) ===`);
console.log(
  `${safelyComparableCandidates.length} total (of ${allHits.length} anchor hits): all scale with the applicant's own ` +
    `household ("profile"), zero fraction-notation, zero fixed-reference, zero individual/table/status/insurance/` +
    `소득인정액/wage/couple metric, AND carry an EXPLICIT positive household-income label nearby — this is the ONLY ` +
    `figure that should be reported as "safe" going forward.`
);
console.log(
  `Delta trail (for context only — none of the prior numbers are the current headline):\n` +
    `  checkpoint-4 (FINAL as of that revision — incomeMetric-aware, "fixed"/fraction-form excluded, but NO positive-signal requirement): ${CHECKPOINT4_SAFELY_COMPARABLE_COUNT}\n` +
    `  checkpoint-4-equivalent recomputed on this run (same profile/fraction filter, no positive-signal requirement): ${checkpoint4EquivalentSafeCount}\n` +
    `  checkpoint-5 (this run, FINAL — matches production exactly, positive-signal REQUIRED): ${safelyComparableCandidates.length}\n` +
    `checkpoint-4 -> checkpoint-5 delta = ${safelyComparableCandidates.length - checkpoint4EquivalentSafeCount} ` +
    `(-${positiveEvidenceImpactExcludedCount} hits that had percent+boundary+profile-size+no-fraction but NO explicit ` +
    `positive household-income label nearby -- now bucket K/ambiguous_unqualified instead of bucket A/household_income). ` +
    `Also newly excluded from bucket A entirely (never reached the safe filter to begin with, checkpoint-5 new buckets): ` +
    `${wageIncomeExcludedCount} wage/earned-income hits (bucket I, real example 515000000168) and ` +
    `${coupleIncomeExcludedCount} couple-combined-income hits (bucket J, real examples 373000000116, 402000000115, ` +
    `535000000607, 519000000153).`
);
console.log(`소득인정액 (bucket B) count: ${bucketHits.B.length}`);
console.log(`건강보험료/건보료 proxy (bucket C) count: ${bucketHits.C.length}`);
console.log(`개인/본인 소득 (bucket G) count: ${bucketHits.G.length}`);
console.log(`가구원 수 테이블 마커 (bucket H) count: ${bucketHits.H.length}`);
console.log(`임금/근로소득 (bucket I, NEW) count: ${bucketHits.I.length}`);
console.log(`부부합산소득 (bucket J, NEW) count: ${bucketHits.J.length}`);
console.log(`Ambiguous/unqualified household-income-shaped, no positive signal (bucket K, NEW) count: ${bucketHits.K.length}`);
console.log(`Ambiguous (bucket F) count: ${bucketHits.F.length}`);
console.log(`Fixed-reference hits excluded from safe count: ${fixedModeExcludedCount}`);
console.log(`Fraction-notation hits excluded from safe count: ${fractionFormSafeExcluded}`);
console.log(`Positive-evidence impact (checkpoint-5 core fix) excluded count: ${positiveEvidenceImpactExcludedCount}`);

for (const b of BUCKET_KEYS) {
  console.log(`\n--- ${BUCKET_LABELS[b]} (matchCount=${bucketHits[b].length}, distinctRecords=${bucketServiceIds[b].size}) ---`);
  for (const h of bucketHits[b].slice(0, 10)) {
    console.log(`  [${h.serviceId}/${h.sourceField}] ${h.excerpt}`);
  }
}

fs.writeFileSync(
  "/tmp/median-income-audit.json",
  JSON.stringify(
    {
      totalRows: rows.length,
      anySignalCount: anySignalServiceIds.size,
      totalAnchorHits: allHits.length,
      sourceFieldDistribution,
      gijunPrefixedCount,
      incomeMetricCounts,
      percentFrequency: Object.fromEntries(percentFrequency),
      boundaryWordFrequency: Object.fromEntries(boundaryWordFrequency),
      yearFrequency: Object.fromEntries(yearFrequency),
      noYearCount,
      householdSizeModeCount,
      bucketAAmbiguousHouseholdSizeCount,
      krwAmountCount,
      monthlyVsAnnual,
      orAndStructureCount,
      safelyComparableCandidateCount: safelyComparableCandidates.length,
      fixedModeExcludedCount,
      fractionFormSafeExcluded,
      positiveEvidenceImpactExcludedCount,
      wageIncomeExcludedCount,
      coupleIncomeExcludedCount,
      checkpoint4SafelyComparableCount: CHECKPOINT4_SAFELY_COMPARABLE_COUNT,
      checkpoint4EquivalentSafeCount,
      buckets: Object.fromEntries(
        BUCKET_KEYS.map((b) => [
          b,
          {
            label: BUCKET_LABELS[b],
            matchCount: bucketHits[b].length,
            distinctRecordCount: bucketServiceIds[b].size,
            hits: bucketHits[b],
          },
        ])
      ),
    },
    null,
    2
  )
);
console.log("\nFull (uncapped) report written to /tmp/median-income-audit.json");
