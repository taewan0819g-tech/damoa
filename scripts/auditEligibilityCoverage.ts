/**
 * READ-ONLY eligibility coverage audit against the real MOIS + Youth Center
 * catalogs. Does not modify, call, or depend on any production matching
 * behavior — it only fetches raw data (via the same live endpoints the real
 * providers use) and the existing, unmodified normalizer/parser functions
 * (normalizeMOISServiceListItem, normalizeMOISSupportConditions,
 * normalizeYouthPolicy, extractEligibilityFromText) to measure what data we
 * currently have vs. what we currently turn into structured rules.
 *
 * Run with:
 *   node --env-file=.env.local -r tsx/cjs scripts/auditEligibilityCoverage.ts
 *
 * Writes a full JSON report to /tmp/eligibility-audit.json (large
 * enumerations — JA-field inventory, Youth code frequency tables, sample
 * titles) and prints a condensed summary to stdout.
 */
import fs from "fs";
import {
  normalizeMOISServiceListItem,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawSupportCondition,
} from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import type { Benefit, EligibilityRule, EligibilityRuleGroup } from "../types/benefit";

// ---------------------------------------------------------------------------
// Raw fetch (mirrors providers/*.ts pagination exactly; kept independent so
// this script never imports the production provider layer / caching).
// ---------------------------------------------------------------------------

const MOIS_BASE = "https://api.odcloud.kr/api/gov24/v3";
const YOUTH_BASE = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

async function fetchMoisAll<T>(path: string, key: string): Promise<T[]> {
  const PER_PAGE = 1000;
  const MAX_PAGES = 30;
  const results: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${MOIS_BASE}${path}?page=${page}&perPage=${PER_PAGE}`, {
      headers: { Authorization: `Infuser ${key}` },
    });
    if (!res.ok) {
      console.error(`MOIS ${path} HTTP ${res.status} on page ${page}`);
      break;
    }
    const json = (await res.json()) as { data: T[]; totalCount: number };
    results.push(...json.data);
    if (json.data.length < PER_PAGE || page * PER_PAGE >= json.totalCount) break;
  }
  return results;
}

async function fetchYouthAll(key: string): Promise<YouthRawPolicy[]> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 20;
  const results: YouthRawPolicy[] = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = `${YOUTH_BASE}?apiKeyNm=${key}&pageType=1&rtnType=json&pageNum=${pageNum}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Youth getPlcy HTTP ${res.status} on page ${pageNum}`);
      break;
    }
    const json = (await res.json()) as {
      resultCode: number;
      result?: { pagging?: { totCount: number }; youthPolicyList?: YouthRawPolicy[] };
    };
    if (json.resultCode !== 200) break;
    const list = json.result?.youthPolicyList ?? [];
    const totCount = json.result?.pagging?.totCount ?? 0;
    results.push(...list);
    if (list.length < PAGE_SIZE || pageNum * PAGE_SIZE >= totCount) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Dimension classification (audit-only mirror of candidateIndex.ts's
// classifyDimension — duplicated here, read-only, purely for reporting;
// does not touch or replace the production classifier).
// ---------------------------------------------------------------------------
type Dimension =
  | "age"
  | "region"
  | "income"
  | "employment"
  | "education"
  | "maritalFamily"
  | "housing"
  | "business"
  | "applicantScope";

function classifyRuleDimension(rule: EligibilityRule): Dimension | undefined {
  if (rule.field === "age") return "age";
  if (rule.operator === "region_in") return "region";
  if (rule.operator === "target_scope_in") return "applicantScope";
  if (
    rule.field === "individualIncomeRange" ||
    rule.field === "householdIncomeRange" ||
    rule.field === "annualIndividualIncome" ||
    rule.field === "annualHouseholdIncome"
  )
    return "income";
  if (rule.field === "employmentStatus" || rule.field === "smeEmployee") return "employment";
  if (rule.field === "educationStatus") return "education";
  if (rule.field === "homeowner" || rule.field === "housingType") return "housing";
  if (rule.field === "businessOwner") return "business";
  return undefined; // e.g. childrenCount -> not one of the 9 audited dimensions
}

function dimensionsInEligibility(eligibility: EligibilityRuleGroup | undefined): Set<Dimension> {
  const set = new Set<Dimension>();
  if (!eligibility) return set;
  const walk = (node: EligibilityRule | EligibilityRuleGroup) => {
    if ("rules" in node) {
      for (const child of node.rules) walk(child);
      return;
    }
    const dim = classifyRuleDimension(node);
    if (dim) set.add(dim);
  };
  walk(eligibility);
  return set;
}

// ---------------------------------------------------------------------------
// Heuristic "raw signal present" detectors — READ-ONLY reporting proxies,
// not production logic. Mirror the keyword sets the real deterministic
// parser (koreanEligibilityParser.ts) uses where applicable, PLUS a
// marital/family detector (the production parser currently has none at
// all, so this exists purely to measure headroom for section 7/8).
// ---------------------------------------------------------------------------
const SIGNAL_PATTERNS: Record<Dimension, RegExp> = {
  age: /만?\s*\d{1,3}\s*세/,
  region: /(거주|주민등록)/,
  income: /(연\s?소득|기준\s*중위소득|소득\s*(수준|기준|분위))/,
  employment: /(미취업|재직|구직|실업|취업자|근로자)/,
  education: /(대학생|대학원생|고등학생|재학생|재학중|학생)/,
  maritalFamily: /(혼인|기혼|미혼|이혼|사별|한부모|다문화|조손|새터민|다자녀|배우자|가족)/,
  housing: /(무주택|주택\s*보유|임차|전세|월세|자가)/,
  business: /(사업자등록|창업|소상공인|자영업)/,
  applicantScope: /(법인|단체|개인|가구|소상공인)/,
};

function textSignals(text: string): Set<Dimension> {
  const set = new Set<Dimension>();
  for (const [dim, re] of Object.entries(SIGNAL_PATTERNS) as [Dimension, RegExp][]) {
    if (re.test(text)) set.add(dim);
  }
  return set;
}

// ---------------------------------------------------------------------------
// 신청기한 (MOIS) classification
// ---------------------------------------------------------------------------
type DeadlineClass =
  | "parseable_date_range"
  | "parseable_end_date"
  | "open_ended"
  | "budget_exhaustion"
  | "other_free_text"
  | "missing_malformed";

const DATE_RANGE_RE =
  /(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})일?\s*[~\-–]\s*(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})일?/;
const END_DATE_ONLY_RE = /(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})일?\s*까지/;
const OPEN_ENDED_RE = /(상시|연중|수시|채용\s*시|채용시)/;
const BUDGET_RE = /(예산\s*소진|소진\s*시|선착순)/;

function classifyDeadline(raw: string | undefined): DeadlineClass {
  if (!raw || !raw.trim()) return "missing_malformed";
  const text = raw.trim();
  if (DATE_RANGE_RE.test(text)) return "parseable_date_range";
  if (END_DATE_ONLY_RE.test(text)) return "parseable_end_date";
  if (OPEN_ENDED_RE.test(text)) return "open_ended";
  if (BUDGET_RE.test(text)) return "budget_exhaustion";
  return "other_free_text";
}

// ---------------------------------------------------------------------------
// Generic frequency-table helper
// ---------------------------------------------------------------------------
function freqTable<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function topEntries<T>(m: Map<T, number>, n: number): [T, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function main() {
  const moisKey = process.env.MOIS_API_KEY;
  const youthKey = process.env.YOUTH_POLICY_API_KEY;
  if (!moisKey) throw new Error("MOIS_API_KEY not set");
  if (!youthKey) throw new Error("YOUTH_POLICY_API_KEY not set");

  console.log("Fetching raw MOIS serviceList + supportConditions, and raw Youth Center policies...");
  const [moisRawList, moisRawConditions, youthRaw] = await Promise.all([
    fetchMoisAll<MOISRawServiceListItem>("/serviceList", moisKey),
    fetchMoisAll<MOISRawSupportCondition>("/supportConditions", moisKey),
    fetchYouthAll(youthKey),
  ]);
  console.log(`MOIS serviceList: ${moisRawList.length} rows`);
  console.log(`MOIS supportConditions: ${moisRawConditions.length} rows`);
  console.log(`Youth Center: ${youthRaw.length} rows`);

  // Build 서비스ID -> supportConditions row map, and -> title map.
  const conditionsById = new Map<string, MOISRawSupportCondition>();
  for (const row of moisRawConditions) conditionsById.set(row.서비스ID, row);
  const titleById = new Map<string, string>();
  for (const row of moisRawList) titleById.set(row.서비스ID, row.서비스명);

  // Normalize via the REAL, unmodified adapter functions (never reimplemented).
  const moisBenefits: Benefit[] = moisRawList.map((raw) => {
    const condRow = conditionsById.get(raw.서비스ID);
    const ageGroup = condRow ? normalizeMOISSupportConditions(condRow) : undefined;
    return normalizeMOISServiceListItem(raw, ageGroup);
  });
  const youthBenefits: Benefit[] = youthRaw.map(normalizeYouthPolicy);

  // =========================================================================
  // Section 2: per-dimension coverage (MOIS)
  // =========================================================================
  const DIMENSIONS: Dimension[] = [
    "age",
    "region",
    "income",
    "employment",
    "education",
    "maritalFamily",
    "housing",
    "business",
    "applicantScope",
  ];

  function moisDimensionReport() {
    const rawAvailable: Record<Dimension, number> = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<
      Dimension,
      number
    >;
    const structured: Record<Dimension, number> = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<
      Dimension,
      number
    >;

    for (let i = 0; i < moisRawList.length; i++) {
      const raw = moisRawList[i];
      const benefit = moisBenefits[i];
      const text = `${raw.지원대상 ?? ""} ${raw.선정기준 ?? ""}`;
      const signals = textSignals(text);

      // age: structured signal is JA0110/JA0111 (authoritative), union with text mention.
      const condRow = conditionsById.get(raw.서비스ID);
      if ((typeof condRow?.JA0110 === "number" && typeof condRow?.JA0111 === "number") || signals.has("age")) {
        rawAvailable.age++;
      }
      // applicantScope: structured 사용자구분 field non-blank, union with text mention.
      const scope = (raw as { 사용자구분?: unknown }).사용자구분;
      if ((typeof scope === "string" && scope.trim()) || signals.has("applicantScope")) {
        rawAvailable.applicantScope++;
      }
      for (const dim of ["region", "income", "employment", "education", "maritalFamily", "housing", "business"] as Dimension[]) {
        if (signals.has(dim)) rawAvailable[dim]++;
      }

      const producedDims = dimensionsInEligibility(benefit.eligibility);
      for (const dim of producedDims) structured[dim]++;
    }

    return DIMENSIONS.map((dim) => {
      const avail = rawAvailable[dim];
      const struct = structured[dim];
      const unresolved = Math.max(0, avail - struct);
      return {
        dimension: dim,
        rawFieldAvailableCount: avail,
        structuredRuleCount: struct,
        unresolvedUnparsedCount: unresolved,
        percentageCoverage: avail > 0 ? Number(((struct / avail) * 100).toFixed(1)) : null,
      };
    });
  }

  function youthDimensionReport() {
    const rawAvailable: Record<Dimension, number> = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<
      Dimension,
      number
    >;
    const structured: Record<Dimension, number> = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<
      Dimension,
      number
    >;
    let incomeNoCondition = 0; // earnCndSeCd === "0043001"
    let incomeStructuredCode = 0; // earnCndSeCd === "0043002"
    let incomeFreeTextOnly = 0; // earnCndSeCd === "0043003"
    let incomeOtherCode = 0;

    for (let i = 0; i < youthRaw.length; i++) {
      const raw = youthRaw[i];
      const benefit = youthBenefits[i];

      if (raw.sprtTrgtAgeLmtYn === "Y" || (raw.sprtTrgtMinAge ?? "").trim() || (raw.sprtTrgtMaxAge ?? "").trim()) {
        rawAvailable.age++;
      }
      if (String(raw.zipCd ?? "").trim()) rawAvailable.region++;
      if ((raw.earnCndSeCd ?? "").trim()) rawAvailable.income++;
      if (String(raw.jobCd ?? "").trim()) rawAvailable.employment++;
      if (String(raw.schoolCd ?? "").trim()) rawAvailable.education++;
      if (String(raw.mrgSttsCd ?? "").trim()) rawAvailable.maritalFamily++;
      if (String(raw.sbizCd ?? "").trim()) rawAvailable.business++;
      // No confirmed applicant-scope field for Youth Center — plcyMajorCd is
      // the closest candidate but its meaning is NOT confirmed (see section 3/8).
      // Left at 0 deliberately rather than guessed.

      switch (raw.earnCndSeCd) {
        case "0043001":
          incomeNoCondition++;
          break;
        case "0043002":
          incomeStructuredCode++;
          break;
        case "0043003":
          incomeFreeTextOnly++;
          break;
        default:
          if ((raw.earnCndSeCd ?? "").trim()) incomeOtherCode++;
      }

      const producedDims = dimensionsInEligibility(benefit.eligibility);
      for (const dim of producedDims) structured[dim]++;
    }

    const report = DIMENSIONS.map((dim) => {
      const avail = rawAvailable[dim];
      const struct = structured[dim];
      const unresolved = Math.max(0, avail - struct);
      return {
        dimension: dim,
        rawFieldAvailableCount: avail,
        structuredRuleCount: struct,
        unresolvedUnparsedCount: unresolved,
        percentageCoverage: avail > 0 ? Number(((struct / avail) * 100).toFixed(1)) : null,
      };
    });

    return { report, incomeNoCondition, incomeStructuredCode, incomeFreeTextOnly, incomeOtherCode };
  }

  const moisDims = moisDimensionReport();
  const youthDimsResult = youthDimensionReport();

  // =========================================================================
  // Section 3: Youth raw code fields — distinct values, frequency, samples
  // =========================================================================
  const YOUTH_CODE_FIELDS = ["jobCd", "schoolCd", "mrgSttsCd", "sbizCd", "zipCd", "plcyMajorCd"] as const;
  const youthCodeReports: Record<string, unknown> = {};
  for (const field of YOUTH_CODE_FIELDS) {
    const values = youthRaw.map((r) => String((r as Record<string, unknown>)[field] ?? "").trim());
    const freq = freqTable(values);
    const total = values.length;
    const distinctCount = freq.size;
    // "significant" = top 12 values by frequency (or all if fewer).
    const top = topEntries(freq, 12);
    const byValueSamples: Record<string, { count: number; percentage: number; samples: { title: string; support: string }[] }> = {};
    for (const [value, count] of top) {
      const matchingIdx: number[] = [];
      for (let i = 0; i < youthRaw.length && matchingIdx.length < 20; i++) {
        if (String((youthRaw[i] as Record<string, unknown>)[field] ?? "").trim() === value) matchingIdx.push(i);
      }
      byValueSamples[value || "(blank)"] = {
        count,
        percentage: Number(((count / total) * 100).toFixed(1)),
        samples: matchingIdx.map((i) => ({
          title: youthRaw[i].plcyNm,
          support: (youthRaw[i].plcySprtCn ?? youthRaw[i].plcyExplnCn ?? "").slice(0, 120),
        })),
      };
    }
    youthCodeReports[field] = { totalRows: total, distinctValueCount: distinctCount, topValues: byValueSamples };
  }

  // =========================================================================
  // Section 4: MOIS supportConditions JA-field inventory
  // =========================================================================
  const jaFieldPopulated = new Map<string, number>();
  const jaFieldValuePatterns = new Map<string, Set<string>>();
  const jaFieldServiceIds = new Map<string, string[]>();
  for (const row of moisRawConditions) {
    for (const [key, value] of Object.entries(row)) {
      if (!/^JA\d+$/.test(key)) continue;
      if (value === null || value === undefined || value === "") continue;
      jaFieldPopulated.set(key, (jaFieldPopulated.get(key) ?? 0) + 1);
      const set = jaFieldValuePatterns.get(key) ?? new Set<string>();
      set.add(`${typeof value}:${String(value).slice(0, 24)}`);
      jaFieldValuePatterns.set(key, set);
      const ids = jaFieldServiceIds.get(key) ?? [];
      if (ids.length < 5) ids.push(row.서비스ID);
      jaFieldServiceIds.set(key, ids);
    }
  }
  const jaInventory = [...jaFieldPopulated.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([field, count]) => ({
      field,
      populatedCount: count,
      percentageOfCatalog: Number(((count / moisRawConditions.length) * 100).toFixed(1)),
      distinctValuePatterns: [...(jaFieldValuePatterns.get(field) ?? [])].slice(0, 10),
      representativeTitles: (jaFieldServiceIds.get(field) ?? []).map((id) => titleById.get(id) ?? id),
      trusted: field === "JA0110" || field === "JA0111",
    }));

  // =========================================================================
  // Section 5: MOIS 신청기한 classification
  // =========================================================================
  const deadlineClasses = moisRawList.map((r) => classifyDeadline(r.신청기한));
  const deadlineFreq = freqTable(deadlineClasses);
  const deadlineSamples: Record<string, string[]> = {};
  for (const cls of new Set(deadlineClasses)) {
    const samples: string[] = [];
    for (const r of moisRawList) {
      if (classifyDeadline(r.신청기한) === cls && samples.length < 8) samples.push(r.신청기한 ?? "(missing)");
    }
    deadlineSamples[cls] = samples;
  }
  // Confirm (from source, not guessed) whether 신청기한 currently feeds application.startDate/endDate at all.
  const moisAppDateUsage = moisBenefits.filter((b) => b.application?.startDate || b.application?.endDate).length;

  // Youth parallel check: does bizPrdEtcCn (free text) carry date info that bizPrdBgngYmd/EndYmd miss?
  let youthBlankStructuredDatesButHasEtcCn = 0;
  let youthHasStructuredDates = 0;
  for (const r of youthRaw) {
    const hasStart = (r.bizPrdBgngYmd ?? "").trim().length > 0;
    const hasEnd = (r.bizPrdEndYmd ?? "").trim().length > 0;
    if (hasStart || hasEnd) youthHasStructuredDates++;
    else if ((r.bizPrdEtcCn ?? "").trim().length > 0) youthBlankStructuredDatesButHasEtcCn++;
  }

  // =========================================================================
  // Section 6: rule coverage per policy (both sources)
  // =========================================================================
  function ruleCoverageBuckets(benefits: Benefit[]) {
    const buckets = { zero: 0, one: 0, two: 0, threePlus: 0, hasUnresolved: 0 };
    for (const b of benefits) {
      const n = dimensionsInEligibility(b.eligibility).size;
      if (n === 0) buckets.zero++;
      else if (n === 1) buckets.one++;
      else if (n === 2) buckets.two++;
      else buckets.threePlus++;
      if (b.hasUnresolvedEligibility) buckets.hasUnresolved++;
    }
    return buckets;
  }
  const moisRuleCoverage = ruleCoverageBuckets(moisBenefits);
  const youthRuleCoverage = ruleCoverageBuckets(youthBenefits);

  // =========================================================================
  // Assemble full report
  // =========================================================================
  const report = {
    section1_totals: { moisTotal: moisRawList.length, youthTotal: youthRaw.length },
    section2_moisDimensionCoverage: moisDims,
    section2_youthDimensionCoverage: youthDimsResult.report,
    section2_youthIncomeCodeBreakdown: {
      "0043001_no_condition": youthDimsResult.incomeNoCondition,
      "0043002_structured": youthDimsResult.incomeStructuredCode,
      "0043003_free_text_only": youthDimsResult.incomeFreeTextOnly,
      other_or_blank: youthDimsResult.incomeOtherCode,
    },
    section3_youthCodeFields: youthCodeReports,
    section4_moisJaInventory: jaInventory,
    section5_moisDeadlineClassification: {
      counts: Object.fromEntries(deadlineFreq.entries()),
      percentages: Object.fromEntries(
        [...deadlineFreq.entries()].map(([k, v]) => [k, Number(((v / moisRawList.length) * 100).toFixed(1))])
      ),
      samples: deadlineSamples,
      moisRecordsWithAnyApplicationDateSetToday: moisAppDateUsage,
      moisTotalRecords: moisRawList.length,
    },
    section5_youthDeadlineCrossCheck: {
      youthHasStructuredDates,
      youthBlankStructuredDatesButHasEtcCn,
      youthTotalRecords: youthRaw.length,
    },
    section6_moisRuleCoverage: moisRuleCoverage,
    section6_youthRuleCoverage: youthRuleCoverage,
  };

  fs.writeFileSync("/tmp/eligibility-audit.json", JSON.stringify(report, null, 2));
  console.log("\nFull report written to /tmp/eligibility-audit.json");
  console.log("\n=== CONDENSED SUMMARY ===");
  console.log(JSON.stringify(report.section1_totals, null, 2));
  console.log("\nMOIS dimension coverage:");
  console.table(moisDims);
  console.log("\nYouth dimension coverage:");
  console.table(youthDimsResult.report);
  console.log("\nYouth income code breakdown:", report.section2_youthIncomeCodeBreakdown);
  console.log("\nMOIS deadline classification counts:", report.section5_moisDeadlineClassification.counts);
  console.log("MOIS deadline classification percentages:", report.section5_moisDeadlineClassification.percentages);
  console.log(
    "MOIS records with ANY application.startDate/endDate set today:",
    moisAppDateUsage,
    "/",
    moisRawList.length
  );
  console.log("Youth records with structured bizPrd dates:", youthHasStructuredDates, "/", youthRaw.length);
  console.log(
    "Youth records with BLANK structured dates but non-blank bizPrdEtcCn (date info stuck in free text):",
    youthBlankStructuredDatesButHasEtcCn
  );
  console.log("\nMOIS rule coverage buckets:", moisRuleCoverage);
  console.log("Youth rule coverage buckets:", youthRuleCoverage);
  console.log("\nJA-field inventory field count:", jaInventory.length);
  console.log("Top 15 JA fields by populated count:");
  console.table(jaInventory.slice().sort((a, b) => b.populatedCount - a.populatedCount).slice(0, 15).map((f) => ({
    field: f.field,
    populatedCount: f.populatedCount,
    pct: f.percentageOfCatalog,
    trusted: f.trusted,
  })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
