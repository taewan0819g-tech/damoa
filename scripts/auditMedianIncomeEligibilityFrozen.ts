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
 * Production code (lib/eligibility/extraction/koreanEligibilityParser.ts,
 * MEDIAN_INCOME_RE) already deliberately treats every 기준중위소득 match as
 * `unresolved` — this script exists to find out, from real data, whether
 * (and which subset of) that can safely change.
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
const HOUSEHOLD_SIZE_RE = /(\d)\s*인\s*(?:가구|가족)/;
const KRW_AMOUNT_RE = /[\d,]{4,}\s*원/;
const SODEUK_INJEONGAEK_RE = /소득인정액/;
const INSURANCE_RE = /건강보험료|건보료/;
const CATEGORY_STATUS_RE = /기초생활수급자|수급자|차상위|기초수급/;
const MONTHLY_RE = /월\s*(?:소득|기준)|월별/;
const ANNUAL_RE = /연\s*(?:소득|소득액)/;
const OR_STRUCTURE_RE = /또는|이거나/;
const AND_STRUCTURE_RE = /그리고|이면서|이고\s/;
const APPLICANT_REF_RE = /본인|신청자\s*(?:개인)?\s*소득|개인\s*소득/;
const HOUSEHOLD_REF_RE = /가구|세대/;
// Distinguishes a FIXED reference household size used as a flat threshold
// for every applicant (e.g. "3인 가구 기준 중위소득") from language that
// scales the threshold to the applicant's actual household size (e.g. "가구원
// 수에 따른 기준중위소득", "가구별 기준중위소득"). Real MOIS text uses both
// shapes and they are NOT interchangeable for rule purposes.
const SCALES_WITH_HOUSEHOLD_RE = /가구원\s*수|가구별|세대원\s*수|가구\s*규모/;

interface Signals {
  percent?: number;
  fractionForm?: boolean; // e.g. "100분의 50"
  boundaryWord?: string;
  explicitYear?: number;
  householdSizeNearby?: number;
  scalesWithApplicantHousehold: boolean;
  fixedReferenceHousehold: boolean;
  krwAmountNearby: boolean;
  sodeukInjeongaekNearby: boolean;
  insuranceNearby: boolean;
  categoryStatusNearby: boolean;
  monthlyWording: boolean;
  annualWording: boolean;
  orStructure: boolean;
  andStructure: boolean;
  applicantScoped: boolean;
  householdScoped: boolean;
  gijunPrefixed: boolean;
}

function extractSignals(text: string, matchIndex: number, matchLen: number): Signals {
  const start = Math.max(0, matchIndex - WINDOW);
  const end = Math.min(text.length, matchIndex + matchLen + WINDOW);
  const before = text.slice(start, matchIndex);
  const after = text.slice(matchIndex + matchLen, end);
  const window = before + after;

  const pctM = PERCENT_RE.exec(after) ?? PERCENT_RE.exec(before);
  const fracM = FRACTION_RE.exec(after) ?? FRACTION_RE.exec(before);
  const boundaryM = BOUNDARY_RE.exec(after);
  const yearM = YEAR_RE.exec(window);
  const sizeM = HOUSEHOLD_SIZE_RE.exec(window);

  return {
    percent: pctM ? Number(pctM[1]) : fracM ? (Number(fracM[2]) / Number(fracM[1])) * 100 : undefined,
    fractionForm: Boolean(fracM),
    boundaryWord: boundaryM?.[0],
    explicitYear: yearM ? Number(yearM[1]) : undefined,
    householdSizeNearby: sizeM ? Number(sizeM[1]) : undefined,
    // A household-size number appearing near 기준중위소득 (e.g. "3인가구 기준
    // 중위소득", "4인가구 기준 60%이하") is treated as a FIXED reference size
    // UNLESS the text separately signals that the threshold scales with the
    // applicant's own household size (가구원 수/가구별/가구 규모 wording,
    // e.g. "가구 규모별 기준 중위소득"). No further hint word is required —
    // manual review of the raw hits showed the bare "N인가구 기준중위소득"
    // shape is itself the fixed-reference idiom in real MOIS text.
    scalesWithApplicantHousehold: SCALES_WITH_HOUSEHOLD_RE.test(window),
    fixedReferenceHousehold: Boolean(sizeM) && !SCALES_WITH_HOUSEHOLD_RE.test(window),
    krwAmountNearby: KRW_AMOUNT_RE.test(window),
    sodeukInjeongaekNearby: SODEUK_INJEONGAEK_RE.test(window),
    insuranceNearby: INSURANCE_RE.test(window),
    categoryStatusNearby: CATEGORY_STATUS_RE.test(window),
    monthlyWording: MONTHLY_RE.test(window),
    annualWording: ANNUAL_RE.test(window),
    orStructure: OR_STRUCTURE_RE.test(window),
    andStructure: AND_STRUCTURE_RE.test(window),
    applicantScoped: APPLICANT_REF_RE.test(window),
    householdScoped: HOUSEHOLD_REF_RE.test(window),
    gijunPrefixed: false, // filled in by caller (depends on match[1])
  };
}

// ---------------------------------------------------------------------------
// Semantic bucket classifier — priority-ordered per the Phase 3 spec:
//   C. HEALTH-INSURANCE-PREMIUM PROXY  (checked first: an insurance-premium
//      proxy clause is never safely a direct household-income threshold,
//      even if it also mentions 가구/이하 wording)
//   B. 소득인정액 THRESHOLD             (asset-adjusted recognized income is
//      never plain household income, checked before A/D)
//   D. CATEGORY / STATUS REFERENCE      (기초생활수급자/차상위 status where no
//      independently comparable threshold is present alongside)
//   A. DIRECT HOUSEHOLD-INCOME THRESHOLD (percent/fraction + boundary word,
//      no insurance/소득인정액 override, not purely a status reference)
//   E. DESCRIPTIVE / NON-ELIGIBILITY MENTION (no boundary word / no percent
//      structure — reads as background description, not a testable rule)
//   F. AMBIGUOUS / OTHER                (fallback)
// ---------------------------------------------------------------------------
type Bucket = "A" | "B" | "C" | "D" | "E" | "F";

function classify(s: Signals): Bucket {
  if (s.insuranceNearby) return "C";
  if (s.sodeukInjeongaekNearby) return "B";
  if (s.categoryStatusNearby && s.percent === undefined) return "D";
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
};

interface Hit {
  serviceId: string;
  sourceField: "지원대상" | "선정기준";
  excerpt: string;
  bucket: Bucket;
  signals: Signals;
}

function excerptAround(text: string, index: number, len: number, pad = 40): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + len + pad);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const allHits: Hit[] = [];
const bucketHits: Record<Bucket, Hit[]> = { A: [], B: [], C: [], D: [], E: [], F: [] };
const bucketServiceIds: Record<Bucket, Set<string>> = { A: new Set(), B: new Set(), C: new Set(), D: new Set(), E: new Set(), F: new Set() };
const anySignalServiceIds = new Set<string>();
const percentFrequency = new Map<number, number>();
const boundaryWordFrequency = new Map<string, number>();
const yearFrequency = new Map<number, number>();
let noYearCount = 0;
const sourceFieldDistribution: Record<"지원대상" | "선정기준", number> = { 지원대상: 0, 선정기준: 0 };
const gijunPrefixedCount = { yes: 0, no: 0 };
const scalesWithHouseholdCount = { yes: 0, no: 0 };
const fixedReferenceHouseholdCount = { yes: 0, no: 0 };
const krwAmountCount = { yes: 0, no: 0 };
const monthlyVsAnnual = { monthly: 0, annual: 0, neither: 0 };
const orAndStructureCount = { or: 0, and: 0, neither: 0 };
const applicantVsHouseholdScope = { applicant: 0, household: 0, both: 0, neither: 0 };

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

      const hit: Hit = {
        serviceId: row.서비스ID,
        sourceField: field,
        excerpt: excerptAround(raw, m.index, m[0].length),
        bucket,
        signals,
      };
      allHits.push(hit);
      bucketHits[bucket].push(hit);
      bucketServiceIds[bucket].add(row.서비스ID);
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
      scalesWithHouseholdCount[signals.scalesWithApplicantHousehold ? "yes" : "no"]++;
      fixedReferenceHouseholdCount[signals.fixedReferenceHousehold ? "yes" : "no"]++;
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
      if (signals.applicantScoped && signals.householdScoped) applicantVsHouseholdScope.both++;
      else if (signals.applicantScoped) applicantVsHouseholdScope.applicant++;
      else if (signals.householdScoped) applicantVsHouseholdScope.household++;
      else applicantVsHouseholdScope.neither++;
    }
  }
  if (hitAny) anySignalServiceIds.add(row.서비스ID);
}

// "Safely comparable" subset per the Phase 3 spec's Section 4 warning: ONLY
// bucket A hits (direct household-income threshold, not 소득인정액, not an
// insurance proxy, not a bare status reference) are even CANDIDATES for
// reuse against existing profile household-income data — and even within
// bucket A, only those that scale with the applicant's actual household
// size (not a fixed reference size) are unambiguously mappable to a single
// per-applicant threshold without additional modeling.
const safelyComparableCandidates = bucketHits.A.filter(
  (h) => !h.signals.fixedReferenceHousehold && h.signals.percent !== undefined
);
const bucketAFixedReferenceCount = bucketHits.A.filter((h) => h.signals.fixedReferenceHousehold).length;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nTotal frozen MOIS records: ${rows.length}`);
console.log(`Records with median-income signal (union): ${anySignalServiceIds.size}`);
console.log(`Total anchor hits (matchCount, uncapped): ${allHits.length}`);
console.log(`Distinct service IDs with ANY median-income anchor hit: ${anySignalServiceIds.size}`);

console.log("\n=== Bucket counts (A-F) ===");
console.table(
  (Object.keys(bucketHits) as Bucket[]).map((b) => ({
    bucket: BUCKET_LABELS[b],
    matchCount: bucketHits[b].length,
    distinctRecords: bucketServiceIds[b].size,
  }))
);

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

console.log("\n=== Household-size scoping ===");
console.log({
  scalesWithApplicantHousehold: scalesWithHouseholdCount,
  fixedReferenceHousehold: fixedReferenceHouseholdCount,
  bucketAFixedReferenceCount,
});

console.log("\n=== KRW amount stated directly nearby ===");
console.log(krwAmountCount);

console.log("\n=== Monthly vs annual wording ===");
console.log(monthlyVsAnnual);

console.log("\n=== OR / AND structure ===");
console.log(orAndStructureCount);

console.log("\n=== Applicant-scoped vs household-scoped wording ===");
console.log(applicantVsHouseholdScope);

console.log(`\n=== Safely-comparable-against-existing-householdIncomeRange candidate count ===`);
console.log(
  `${safelyComparableCandidates.length} of ${bucketHits.A.length} bucket-A hits ` +
    `(bucket A total minus fixed-reference-household-size hits minus unparseable-percent hits)`
);
console.log(`소득인정액 (bucket B) count: ${bucketHits.B.length}`);
console.log(`건강보험료/건보료 proxy (bucket C) count: ${bucketHits.C.length}`);
console.log(`Ambiguous (bucket F) count: ${bucketHits.F.length}`);

for (const b of Object.keys(bucketHits) as Bucket[]) {
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
      percentFrequency: Object.fromEntries(percentFrequency),
      boundaryWordFrequency: Object.fromEntries(boundaryWordFrequency),
      yearFrequency: Object.fromEntries(yearFrequency),
      noYearCount,
      householdScoping: { scalesWithHouseholdCount, fixedReferenceHouseholdCount, bucketAFixedReferenceCount },
      krwAmountCount,
      monthlyVsAnnual,
      orAndStructureCount,
      applicantVsHouseholdScope,
      safelyComparableCandidateCount: safelyComparableCandidates.length,
      buckets: Object.fromEntries(
        (Object.keys(bucketHits) as Bucket[]).map((b) => [
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
