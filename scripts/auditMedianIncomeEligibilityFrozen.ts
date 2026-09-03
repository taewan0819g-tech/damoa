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
 * Production code (lib/eligibility/extraction/koreanEligibilityParser.ts's
 * `parseMedianIncomeClause`) implements the SAME priority-ordered
 * disqualifier logic as this audit (건강보험료 > 소득인정액 > 가구원수 테이블 마커 >
 * 개인/본인 소득 > boundary+percent required > household-size-number
 * ambiguity), so this script's bucket boundaries are a direct cross-check of
 * the production parser's real-world behavior, not an independent heuristic.
 *
 * Checkpoint-4 revision (Phase 3 finalization, section 15): re-synced this
 * audit's "safely comparable" filter and disqualifier regexes against the
 * FINAL, corrected production parser (koreanEligibilityParser.ts as of this
 * commit) after several production-only fixes landed post-checkpoint-3 that
 * this audit had NOT yet mirrored:
 *   1. `fixed_reference_household` is no longer ever auto-inferred by
 *      production — a manual review of all 16 real "exactly one nearby
 *      household-size number" hits (docs/median-income-fixed-reference-review.md)
 *      found only 7/15 distinct services were genuinely fixed-reference, the
 *      rest being either a truncated table view or an incidental target-
 *      population size. Production now treats ANY nearby household-size
 *      number (one OR several) as unresolved. The checkpoint-3
 *      `safelyComparableCandidates` filter still counted "fixed" (16 hits) as
 *      safe — WRONG as of this revision. Fixed: the safe filter now requires
 *      `householdSizeMode === "profile"` exactly (not merely `!== "ambiguous"`).
 *   2. Production added an adjacency-scoped "본인-label" disqualifier
 *      (`MEDIAN_INCOME_INDIVIDUAL_LABEL_RE`) catching phrasing like "(본인)
 *      기준중위소득 120% 이하" that general individual-income wording checks
 *      (bare "개인소득"/"본인 소득") miss. Real examples 서비스ID 627000000136
 *      (대구시 청년 지원 — separately ALSO has a genuine "(가구) 기준중위소득
 *      140% 이하" household clause in the same record) and 628000000748 were
 *      previously MISCLASSIFIED by this audit as bucket A (safe household
 *      income) — confirmed by inspecting the checkpoint-3 JSON report. Fixed:
 *      bucket G's `individualIncomeNearby` signal now also fires on this
 *      adjacency pattern.
 *   3. Production added an explicit per-household-size TABLE MARKER
 *      disqualifier (`MEDIAN_INCOME_TABLE_MARKER_RE`, e.g. "가구원 수에 따라
 *      기준금액 상이", real example 서비스ID 641000000164) that this audit had
 *      no equivalent bucket for at all — such hits fell through to bucket A
 *      or F depending on other signals. Fixed: new bucket H, checked at the
 *      same unconditional-disqualifier priority tier as insurance/소득인정액.
 *   4. Production's metric-disqualifier regex is whitespace-tolerant
 *      (matches "소득 인정액", "소득인 정액", "건 강 보험 료" — real MOIS typo/
 *      spacing variants) where this audit's `SODEUK_INJEONGAEK_RE`/
 *      `INSURANCE_RE` were plain literal-substring checks. Fixed: both
 *      regexes now mirror production's tolerant version exactly.
 *   5. Fraction notation ("100분의 50") is explicitly, deliberately NOT
 *      extracted by production (see the doc comment above
 *      `MEDIAN_INCOME_PERCENT_RE` in koreanEligibilityParser.ts — a review of
 *      all 12 real fraction-notation hits found most reference a DIFFERENT,
 *      disqualifying metric the disqualifier regex only catches with the
 *      whitespace-tolerant fix in point 4). This audit already tracked
 *      `fractionForm` as a signal but still counted such hits toward the safe
 *      total. Fixed: `safelyComparableCandidates` now excludes every
 *      fraction-form hit, reported separately as `fractionFormSafeExcluded`.
 * None of these were "600 safe" to begin with once corrected — see the
 * checkpoint-4 headline below, which intentionally does NOT lead with the
 * stale checkpoint-3 figure.
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
  // Checkpoint-4 (new): anchor-INCLUSIVE window, needed only for regexes
  // whose pattern spans across the anchor match text itself (currently just
  // MEDIAN_INCOME_INDIVIDUAL_LABEL_RE, which ends in "중위소득"). Every other
  // signal below intentionally uses the anchor-EXCLUSIVE `window` above so
  // the anchor's own "중위소득"/"기준중위소득" text never accidentally
  // satisfies an unrelated nearby-wording check.
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
    monthlyWording: MONTHLY_RE.test(window),
    annualWording: ANNUAL_RE.test(window),
    orStructure: OR_STRUCTURE_RE.test(window),
    andStructure: AND_STRUCTURE_RE.test(window),
    householdScoped: HOUSEHOLD_REF_RE.test(window),
    gijunPrefixed: false, // filled in by caller (depends on match[1])
  };
}

// ---------------------------------------------------------------------------
// incomeMetric — a first-class classification independent of the A-G bucket,
// so the "safely comparable" filter and the parser cross-check can both key
// off it directly rather than reverse-engineering it from the bucket letter.
// Priority order mirrors production's parseMedianIncomeClause disqualifier
// checks exactly.
// ---------------------------------------------------------------------------
type IncomeMetric =
  | "health_insurance_premium"
  | "recognized_income"
  | "table_reference"
  | "individual_income"
  | "category_status"
  | "household_income"
  | "ambiguous";

function classifyIncomeMetric(s: Signals): IncomeMetric {
  if (s.insuranceNearby) return "health_insurance_premium";
  if (s.sodeukInjeongaekNearby) return "recognized_income";
  // Checkpoint-4 (new): table-marker disqualifier, checked at the same
  // unconditional-disqualifier priority tier as insurance/소득인정액 above —
  // mirrors production checking MEDIAN_INCOME_TABLE_MARKER_RE alongside
  // MEDIAN_INCOME_METRIC_DISQUALIFIER_RE in a single combined `||` check.
  if (s.tableMarkerNearby) return "table_reference";
  if (s.individualIncomeNearby) return "individual_income";
  if (s.categoryStatusNearby && s.percent === undefined && !s.fractionForm) return "category_status";
  if ((s.percent !== undefined || s.fractionForm) && s.boundaryWord) return "household_income";
  return "ambiguous";
}

// ---------------------------------------------------------------------------
// Semantic bucket classifier — priority-ordered per the Phase 3 spec,
// extended (checkpoint-3) with bucket G for individual/applicant-scoped
// income, checked BEFORE a hit is allowed into bucket A:
//   C. HEALTH-INSURANCE-PREMIUM PROXY  (checked first: an insurance-premium
//      proxy clause is never safely a direct household-income threshold,
//      even if it also mentions 가구/이하 wording)
//   B. 소득인정액 THRESHOLD             (asset-adjusted recognized income is
//      never plain household income, checked before A/D/G)
//   H. PER-HOUSEHOLD-SIZE TABLE MARKER (checkpoint-4, new: "가구원 수에 따라"/
//      "가구 규모별" — an unconditional disqualifier, checked at the same
//      priority tier as B/C above, before G/D/A)
//   G. INDIVIDUAL / APPLICANT-SCOPED INCOME (개인소득/본인(의)/종합소득 소득, or
//      the adjacency-scoped "(본인) 기준중위소득" label — a DIFFERENT metric
//      than household income, checked before D/A)
//   D. CATEGORY / STATUS REFERENCE      (기초생활수급자/차상위 status where no
//      independently comparable threshold is present alongside)
//   A. DIRECT HOUSEHOLD-INCOME THRESHOLD (percent/fraction + boundary word,
//      no insurance/소득인정액/table-marker/individual-income override, not
//      purely a status reference)
//   E. DESCRIPTIVE / NON-ELIGIBILITY MENTION (no boundary word / no percent
//      structure — reads as background description, not a testable rule)
//   F. AMBIGUOUS / OTHER                (fallback)
// ---------------------------------------------------------------------------
type Bucket = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

function classify(s: Signals): Bucket {
  if (s.insuranceNearby) return "C";
  if (s.sodeukInjeongaekNearby) return "B";
  if (s.tableMarkerNearby) return "H";
  if (s.individualIncomeNearby) return "G";
  if (s.categoryStatusNearby && s.percent === undefined && !s.fractionForm) return "D";
  if ((s.percent !== undefined || s.fractionForm) && s.boundaryWord) return "A";
  if (s.boundaryWord === undefined && s.percent === undefined && !s.fractionForm) return "E";
  return "F";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  A: "A. DIRECT HOUSEHOLD-INCOME THRESHOLD",
  B: "B. 소득인정액 THRESHOLD",
  C: "C. HEALTH-INSURANCE-PREMIUM PROXY",
  D: "D. CATEGORY / STATUS REFERENCE",
  E: "E. DESCRIPTIVE / NON-ELIGIBILITY MENTION",
  F: "F. AMBIGUOUS / OTHER",
  G: "G. INDIVIDUAL / APPLICANT-SCOPED INCOME",
  H: "H. PER-HOUSEHOLD-SIZE TABLE MARKER",
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

const BUCKET_KEYS: Bucket[] = ["A", "B", "C", "D", "E", "F", "G", "H"];
const allHits: Hit[] = [];
const bucketHits: Record<Bucket, Hit[]> = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [] };
const bucketServiceIds: Record<Bucket, Set<string>> = {
  A: new Set(), B: new Set(), C: new Set(), D: new Set(), E: new Set(), F: new Set(), G: new Set(), H: new Set(),
};
const incomeMetricCounts: Record<IncomeMetric, number> = {
  health_insurance_premium: 0,
  recognized_income: 0,
  table_reference: 0,
  individual_income: 0,
  category_status: 0,
  household_income: 0,
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

// "Safely comparable" subset (checkpoint-3, corrected): a hit is only a
// candidate for reuse against existing profile household-income data when
// BOTH:
//  - incomeMetric === "household_income" (excludes 소득인정액/insurance/
//    individual-income/bare-category hits — bucket B/C/G/D are ALL excluded
//    by construction, since only bucket A ever produces this incomeMetric)
//  - householdSizeMode !== "ambiguous" (both "profile" AND "fixed" are
//    modelable — "profile" via `scales_with_profile_household`, "fixed" via
//    `fixed_reference_household` + `fixedHouseholdSize` — only 2+ distinct
//    nearby household-size numbers are unsafe)
// Checkpoint-4 revision: neither prior checkpoint's figure is reported as the
// headline anymore — both are kept ONLY as delta-explanation trail entries.
const CHECKPOINT2_SAFELY_COMPARABLE_COUNT = 588; // first (pre-review) checkpoint's reported figure
const CHECKPOINT3_SAFELY_COMPARABLE_COUNT = 600; // checkpoint-3's reported figure (incomeMetric-aware, but still counted "fixed" + fraction-form hits as safe)

// Checkpoint-4, CORRECTED "safely comparable" filter: a hit is only a
// candidate for reuse against existing profile household-income data when
// ALL THREE hold:
//  - incomeMetric === "household_income" (bucket B/C/D/G/H are ALL excluded
//    by construction, since only bucket A ever produces this incomeMetric)
//  - householdSizeMode === "profile" EXACTLY (checkpoint-4 fix #1: "fixed"
//    is no longer counted as safe — production never auto-infers
//    `fixed_reference_household` from text alone; see the module doc comment)
//  - !fractionForm (checkpoint-4 fix #5: fraction notation, e.g. "100분의
//    50", is explicitly unsupported by production and must never count as
//    a safely comparable rule)
const safelyComparableCandidates = allHits.filter(
  (h) => h.incomeMetric === "household_income" && h.signals.householdSizeMode === "profile" && !h.signals.fractionForm
);
// Diagnostic-only counts (NOT part of the safe total) explaining exactly what
// checkpoint-3's more permissive filter used to include:
const fixedModeExcludedCount = allHits.filter(
  (h) => h.incomeMetric === "household_income" && h.signals.householdSizeMode === "fixed"
).length;
const fractionFormSafeExcluded = allHits.filter(
  (h) => h.incomeMetric === "household_income" && h.signals.householdSizeMode === "profile" && h.signals.fractionForm
).length;
const bucketAAmbiguousHouseholdSizeCount = bucketHits.A.filter((h) => h.signals.householdSizeMode === "ambiguous").length;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nTotal frozen MOIS records: ${rows.length}`);
console.log(`Records with median-income signal (union): ${anySignalServiceIds.size}`);
console.log(`Total anchor hits (matchCount, uncapped): ${allHits.length}`);
console.log(`Distinct service IDs with ANY median-income anchor hit: ${anySignalServiceIds.size}`);

console.log("\n=== Bucket counts (A-H) ===");
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

console.log(`\n=== Safely-comparable-against-existing-householdIncomeRange candidate count (CHECKPOINT-4, FINAL) ===`);
console.log(
  `${safelyComparableCandidates.length} total (of ${allHits.length} anchor hits): all scale with the applicant's own ` +
    `household ("profile"), zero fraction-notation, zero fixed-reference, zero individual/table/status/insurance/소득인정액 ` +
    `metric — this is the ONLY figure that should be reported as "safe" going forward.`
);
console.log(
  `Delta trail (for context only — NEITHER prior number is the current headline):\n` +
    `  checkpoint-2 (pre-review, no incomeMetric check): ${CHECKPOINT2_SAFELY_COMPARABLE_COUNT}\n` +
    `  checkpoint-3 (incomeMetric-aware, still counted "fixed" + fraction-form as safe): ${CHECKPOINT3_SAFELY_COMPARABLE_COUNT}\n` +
    `  checkpoint-4 (this run, FINAL — matches production exactly): ${safelyComparableCandidates.length}\n` +
    `Checkpoint-3 -> checkpoint-4 delta = ${safelyComparableCandidates.length - CHECKPOINT3_SAFELY_COMPARABLE_COUNT} ` +
    `(-${fixedModeExcludedCount} now-excluded "fixed" household-size hits [production never auto-infers ` +
    `fixed_reference_household from text alone — see docs/median-income-fixed-reference-review.md], ` +
    `-${fractionFormSafeExcluded} now-excluded fraction-notation hits [production does not support fraction notation]). ` +
    `Also newly excluded from bucket A entirely (never reached the safe filter to begin with): ` +
    `${bucketHits.G.length} individual/applicant-scoped-income hits (bucket G, includes the adjacency-scoped 본인-label ` +
    `pattern — real examples 627000000136 and 628000000748) and ${bucketHits.H.length} per-household-size-table-marker hits ` +
    `(bucket H, real example 641000000164). ${bucketAAmbiguousHouseholdSizeCount} bucket-A hits have 2+ distinct nearby ` +
    `household-size numbers and were already excluded as "ambiguous" as of checkpoint-3 (unchanged).`
);
console.log(`소득인정액 (bucket B) count: ${bucketHits.B.length}`);
console.log(`건강보험료/건보료 proxy (bucket C) count: ${bucketHits.C.length}`);
console.log(`개인/본인 소득 (bucket G) count: ${bucketHits.G.length}`);
console.log(`가구원 수 테이블 마커 (bucket H, NEW) count: ${bucketHits.H.length}`);
console.log(`Ambiguous (bucket F) count: ${bucketHits.F.length}`);
console.log(`Fixed-reference hits excluded from safe count (checkpoint-4 fix #1): ${fixedModeExcludedCount}`);
console.log(`Fraction-notation hits excluded from safe count (checkpoint-4 fix #5): ${fractionFormSafeExcluded}`);

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
      checkpoint2SafelyComparableCount: CHECKPOINT2_SAFELY_COMPARABLE_COUNT,
      checkpoint3SafelyComparableCount: CHECKPOINT3_SAFELY_COMPARABLE_COUNT,
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
