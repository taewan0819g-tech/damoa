/**
 * READ-ONLY frozen before/after audit for the MOIS region-clause-precision
 * fix (Checkpoint: "MOIS Region-Clause Precision correction ONLY").
 *
 * Root cause (confirmed by direct inspection, not guessed): `findProvinceRegionSpecs`
 * scanned an ENTIRE 지원대상/선정기준 field for every province mention, gated
 * only by `parseRegionClause`'s clause-level `hasResidenceSignal(text)` check
 * (does a residence keyword exist ANYWHERE in the text) — never checking that
 * a given province mention was actually near/bound to that signal, unlike the
 * lone-city path (`findLoneCityCandidates`), which already required
 * `isNearAnyIndex` proximity. Real example, MOIS 351050000123 ("미추홀구 청년
 * 면접수당 지원"): 지원대상 = "○ 인천광역시 미추홀구에 주민등록되어있는 ...
 * 청년 ○ 서울, 경기, 인천 소재 기업 및 공공기관 취업면접 ... 응시자" — "주민등록"
 * binds only to "인천광역시 미추홀구"; the second, ○-separated sentence's
 * "서울, 경기, 인천" names the INTERVIEW-eligible employer location, not
 * applicant residence, yet was incorrectly absorbed into the region_in rule
 * (turning 경기도 into a false allowed-residence alternative).
 *
 * Fix: `findProvinceRegionSpecs` now requires each province mention (+ its
 * resolved city/sibling-list span) to be BOUND to a residence signal, via
 * `isBoundToResidenceSignal` — either the existing `CITY_PROXIMITY_WINDOW`
 * (20-char) proximity check (unchanged, handles compact same-sentence lists
 * like "서울, 경기, 인천 거주자"), OR the residence signal occurring in the
 * SAME "○"-delimited clause as the mention (handles a real residence clause
 * with a long descriptive relative clause in between, without re-admitting a
 * later, structurally separate ○-clause describing something else).
 *
 * This script re-derives BOTH the OLD (pre-fix, git blob at the audited HEAD
 * fcca37277703a65f9f45f90130b8d9482fdb7c2d) and NEW (current working tree)
 * `extractEligibilityFromText` region_in output for every MOIS 지원대상/
 * 선정기준 field in the frozen 10,967-row catalog, in the SAME process, so
 * both runs see byte-identical input. ZERO network calls; ZERO other
 * eligibility dimensions touched (age/income/employment/etc. are recomputed
 * by both old and new for the mismatchCount safety check in section 6, using
 * the SAME real extractEligibilityFromText each side already produces).
 *
 * Prerequisite (one-time re-derivation step; NOT a committed file, so this
 * script deliberately loads it via a runtime `require()` of a path built
 * from a string, rather than a static `import`, so `tsc`/typecheck never
 * needs the file to exist on disk — matching the manual-prerequisite
 * precedent already established by scripts/benchmarkRegionExtractionFrozen.ts):
 *   git show fcca37277703a65f9f45f90130b8d9482fdb7c2d:lib/eligibility/extraction/koreanEligibilityParser.ts \
 *     > lib/eligibility/extraction/koreanEligibilityParserOld.ts
 * (place it in the SAME directory as koreanEligibilityParser.ts so its own
 * relative imports, e.g. regionGazetteer.ts/region.ts — unchanged by this
 * checkpoint — resolve correctly. Delete it again once this script has been
 * re-run and its JSON output captured; it must never be committed.)
 *
 * Run with:
 *   npx tsx scripts/auditMoisRegionBindingPrecision.ts
 *
 * Writes docs/audits/mois-region-binding-precision.json (committed).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { extractEligibilityFromText as extractNew } from "../lib/eligibility/extraction/koreanEligibilityParser";
import type { EligibilityRule } from "../types/benefit";

const OLD_PARSER_PATH = path.join(__dirname, "../lib/eligibility/extraction/koreanEligibilityParserOld");
if (!fs.existsSync(OLD_PARSER_PATH + ".ts")) {
  console.error(
    "Missing prerequisite: " +
      OLD_PARSER_PATH +
      ".ts\nRe-derive it first — see the prerequisite comment at the top of this script."
  );
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractEligibilityFromText: extractOld } = require(OLD_PARSER_PATH) as {
  extractEligibilityFromText: typeof extractNew;
};

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const ARTIFACT_PATH = path.join(__dirname, "../docs/audits/mois-region-binding-precision.json");

interface MOISRawRow {
  서비스ID: string;
  서비스명: string;
  지원대상?: string | null;
  선정기준?: string | null;
}

interface RegionSpec {
  province: string;
  city?: string;
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function regionRule(rules: EligibilityRule[]): EligibilityRule | undefined {
  return rules.find((r) => r.field === "residence" && r.operator === "region_in");
}

function specsOf(rule: EligibilityRule | undefined): RegionSpec[] {
  return (rule?.value as RegionSpec[] | undefined) ?? [];
}

function specKey(s: RegionSpec): string {
  return s.city ? `${s.province}|${s.city}` : s.province;
}

// Institution/interview/employer-location keyword set — used ONLY to
// auto-label removed specs for this audit's Category A/B/C classification.
// Never used in production eligibility logic.
const NON_RESIDENCE_CONTEXT_MARKERS = [
  "소재 기업", "소재 기관", "소재 공공기관", "소재 사업장", "소재 학교", "소재 대학", "소재지",
  "면접", "채용", "응시자", "재직", "입사", "근무지", "협력업체", "위촉", "파견", "출장",
];
const RESIDENCE_CONTEXT_MARKERS = ["거주", "주민등록", "주소지", "주소를 둔", "주소를 두고", "주민"];

/** Audit-only heuristic classification of one removed spec, given the field text it came from. Never used in production. */
function classifyRemoval(spec: RegionSpec, text: string): { category: "A" | "B" | "C"; reason: string } {
  const needle = spec.city ?? spec.province;
  const occurrences: number[] = [];
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = text.indexOf(needle, idx + 1);
  }
  // Also try the province alias if a city didn't literally appear (city may
  // have come from a sibling-list expansion under a province mention).
  if (occurrences.length === 0 && spec.city) {
    idx = text.indexOf(spec.province);
    while (idx !== -1) {
      occurrences.push(idx);
      idx = text.indexOf(spec.province, idx + 1);
    }
  }
  if (occurrences.length === 0) return { category: "C", reason: "removed spec token not literally found in field text (came from a sibling-list expansion)" };

  const WINDOW = 40;
  let sawNonResidenceContext = false;
  let sawResidenceContextNearby = false;
  for (const at of occurrences) {
    const windowText = text.slice(Math.max(0, at - WINDOW), at + needle.length + WINDOW);
    if (NON_RESIDENCE_CONTEXT_MARKERS.some((m) => windowText.includes(m))) sawNonResidenceContext = true;
    if (RESIDENCE_CONTEXT_MARKERS.some((m) => windowText.includes(m))) sawResidenceContextNearby = true;
  }
  if (sawNonResidenceContext && !sawResidenceContextNearby) {
    return { category: "A", reason: `non-residence context marker found within ${WINDOW} chars of every occurrence, no residence marker nearby` };
  }
  if (sawResidenceContextNearby) {
    return { category: "B", reason: `a residence-context marker exists within ${WINDOW} chars of an occurrence, but the mention fell outside the new proximity/clause-binding check (likely a longer-range or cross-clause reference)` };
  }
  return { category: "C", reason: "neither a clear non-residence nor a clear nearby residence marker found — needs human review" };
}

function loadFrozenCatalog(): MOISRawRow[] {
  if (!fs.existsSync(MOIS_LIST_PATH)) {
    console.error(`Frozen MOIS snapshot missing at ${MOIS_LIST_PATH} — this audit performs zero live fetches.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
}

interface FieldDiff {
  serviceId: string;
  serviceName: string;
  field: "지원대상" | "선정기준";
  text: string;
  oldOutcome: "rule" | "unresolved" | "none";
  newOutcome: "rule" | "unresolved" | "none";
  oldSpecs: RegionSpec[];
  newSpecs: RegionSpec[];
  removedSpecs: RegionSpec[];
  addedSpecs: RegionSpec[];
}

function outcomeOf(rule: EligibilityRule | undefined, unresolved: string[], text: string): "rule" | "unresolved" | "none" {
  if (rule) return "rule";
  if (unresolved.includes(text)) return "unresolved";
  return "none";
}

function main() {
  const rows = loadFrozenCatalog();
  console.log(`Frozen MOIS snapshot: ${rows.length} rows`);

  const fieldDiffs: FieldDiff[] = [];
  // Safety check (section 6): every OTHER dimension's rule set must be
  // byte-identical old vs new for every field processed — this fix must only
  // ever change the "residence"/region_in rule.
  let unexpectedNonRegionMismatchCount = 0;
  const unexpectedNonRegionMismatchSamples: { serviceId: string; field: string; oldOther: unknown; newOther: unknown }[] = [];

  let fieldsProcessed = 0;

  for (const row of rows) {
    const fields: ["지원대상" | "선정기준", string | null | undefined][] = [
      ["지원대상", row.지원대상],
      ["선정기준", row.선정기준],
    ];
    for (const [fieldName, text] of fields) {
      if (!text || !text.trim()) continue;
      fieldsProcessed++;

      const oldResult = extractOld(fieldName, text);
      const newResult = extractNew(fieldName, text);

      // --- Non-region safety check ---
      const oldOther = oldResult.rules.filter((r) => r.field !== "residence").map((r) => ({ field: r.field, operator: r.operator, value: r.value }));
      const newOther = newResult.rules.filter((r) => r.field !== "residence").map((r) => ({ field: r.field, operator: r.operator, value: r.value }));
      const oldOtherStr = JSON.stringify(oldOther);
      const newOtherStr = JSON.stringify(newOther);
      const oldUnresolvedOther = oldResult.unresolvedClauses.length > 0 && !regionRule(oldResult.rules);
      const newUnresolvedOther = newResult.unresolvedClauses.length > 0 && !regionRule(newResult.rules);
      if (oldOtherStr !== newOtherStr || oldResult.unresolvedClauses.length !== newResult.unresolvedClauses.length) {
        // A field-level unresolvedClauses length change can legitimately be
        // CAUSED by the region rule itself flipping between resolved/
        // unresolved (region contributes its own text to unresolvedClauses
        // only via the OR-cross-dimension safety net, which is unaffected
        // here) — but to be conservative, only count it as an "unexpected
        // NON-region mismatch" when the non-region rule arrays themselves
        // differ, since the region rule's own resolved-vs-unresolved status
        // is an INTENDED region-only change already tracked separately.
        if (oldOtherStr !== newOtherStr) {
          unexpectedNonRegionMismatchCount++;
          if (unexpectedNonRegionMismatchSamples.length < 20) {
            unexpectedNonRegionMismatchSamples.push({ serviceId: row.서비스ID, field: fieldName, oldOther, newOther });
          }
        }
      }
      void oldUnresolvedOther;
      void newUnresolvedOther;

      // --- Region diff ---
      const oldRegionRule = regionRule(oldResult.rules);
      const newRegionRule = regionRule(newResult.rules);
      const oldSpecs = specsOf(oldRegionRule);
      const newSpecs = specsOf(newRegionRule);
      const oldKeys = new Set(oldSpecs.map(specKey));
      const newKeys = new Set(newSpecs.map(specKey));
      const removedSpecs = oldSpecs.filter((s) => !newKeys.has(specKey(s)));
      const addedSpecs = newSpecs.filter((s) => !oldKeys.has(specKey(s)));

      if (removedSpecs.length > 0 || addedSpecs.length > 0) {
        fieldDiffs.push({
          serviceId: row.서비스ID,
          serviceName: row.서비스명,
          field: fieldName,
          text,
          oldOutcome: outcomeOf(oldRegionRule, oldResult.unresolvedClauses, text),
          newOutcome: outcomeOf(newRegionRule, newResult.unresolvedClauses, text),
          oldSpecs,
          newSpecs,
          removedSpecs,
          addedSpecs,
        });
      }
    }
  }

  // --- Aggregate counts ---
  const totalRecords = rows.length;
  function countRecordsWithRegionRule(pick: (r: MOISRawRow) => { rule: boolean; specCount: number }) {
    let recordsWithRule = 0;
    let totalSpecs = 0;
    for (const row of rows) {
      const r = pick(row);
      if (r.rule) recordsWithRule++;
      totalSpecs += r.specCount;
    }
    return { recordsWithRule, totalSpecs };
  }

  const beforeAgg = countRecordsWithRegionRule((row) => {
    let rule = false;
    let specCount = 0;
    for (const text of [row.지원대상, row.선정기준]) {
      if (!text || !text.trim()) continue;
      const r = regionRule(extractOld(text === row.지원대상 ? "지원대상" : "선정기준", text).rules);
      if (r) {
        rule = true;
        specCount += specsOf(r).length;
      }
    }
    return { rule, specCount };
  });
  const afterAgg = countRecordsWithRegionRule((row) => {
    let rule = false;
    let specCount = 0;
    for (const text of [row.지원대상, row.선정기준]) {
      if (!text || !text.trim()) continue;
      const r = regionRule(extractNew(text === row.지원대상 ? "지원대상" : "선정기준", text).rules);
      if (r) {
        rule = true;
        specCount += specsOf(r).length;
      }
    }
    return { rule, specCount };
  });

  const affectedRecordIds = new Set(fieldDiffs.map((d) => d.serviceId));
  const totalRemovedSpecs = fieldDiffs.reduce((n, d) => n + d.removedSpecs.length, 0);
  const totalAddedSpecs = fieldDiffs.reduce((n, d) => n + d.addedSpecs.length, 0);

  // A record is "newly unresolved" (complete loss, not a trim) when it had a
  // resolved rule before and has NEITHER a resolved rule NOR any spec after.
  const newlyEmptyFieldDiffs = fieldDiffs.filter((d) => d.oldOutcome === "rule" && d.newSpecs.length === 0);

  // --- Classification of every removed spec ---
  const classified = fieldDiffs.flatMap((d) =>
    d.removedSpecs.map((spec) => ({
      serviceId: d.serviceId,
      serviceName: d.serviceName,
      field: d.field,
      spec,
      ...classifyRemoval(spec, d.text),
    }))
  );
  const categoryCounts = { A: 0, B: 0, C: 0 };
  for (const c of classified) categoryCounts[c.category]++;

  // Deterministic stratified sample: first 15 per category (or fewer),
  // sorted by serviceId for reproducibility, WITH full source text so a
  // human reviewer can verify the auto-label.
  function sampleCategory(cat: "A" | "B" | "C", n: number) {
    return classified
      .filter((c) => c.category === cat)
      .sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0))
      .slice(0, n)
      .map((c) => {
        const diff = fieldDiffs.find((d) => d.serviceId === c.serviceId && d.field === c.field)!;
        return {
          serviceId: c.serviceId,
          serviceName: c.serviceName,
          field: c.field,
          removedSpec: c.spec,
          reason: c.reason,
          sourceText: diff.text,
        };
      });
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    checkpoint: "MOIS Region-Clause Precision correction ONLY",
    frozenInput: { path: MOIS_LIST_PATH, sha256: sha256File(MOIS_LIST_PATH), rowCount: rows.length },
    auditedBeforeSha: "fcca37277703a65f9f45f90130b8d9482fdb7c2d",
    rootCause:
      "findProvinceRegionSpecs scanned the ENTIRE 지원대상/선정기준 field text for every province mention, gated only by parseRegionClause's clause-level hasResidenceSignal(text) presence check (residence keyword exists SOMEWHERE in the text) — never verifying a given province mention was actually near/bound to that signal, unlike the lone-city path (findLoneCityCandidates), which already required isNearAnyIndex proximity. Confirmed via direct extraction on the real MOIS 351050000123 text.",
    fix:
      "findProvinceRegionSpecs now requires each province mention's resolved span (province + city/sibling-list) to be bound to a residence signal via isBoundToResidenceSignal: EITHER the existing CITY_PROXIMITY_WINDOW=20-char proximity check (handles compact same-sentence OR lists), OR the residence signal occurring in the SAME real MOIS '○'-delimited clause as the mention (handles a real residence clause with a long descriptive relative clause in between, without re-admitting a later, structurally separate ○-clause describing something unrelated).",
    concreteBugReproduction: {
      serviceId: "351050000123",
      serviceName: "미추홀구 청년 면접수당 지원",
      field: "지원대상",
      sourceText:
        "○ 인천광역시 미추홀구에 주민등록되어있는 18~39세 미취업 청년\r\n\r\n○ 서울, 경기, 인천 소재 기업 및 공공기관 취업면접 또는 서울, 인천지역 공무원 면접 응시자",
      expectedSourceSemantics: {
        applicantResidence: "인천광역시 미추홀구에 주민등록된 청년",
        laterMentionIsNotResidence: "서울/경기/인천 소재 기업·공공기관은 면접 응시 대상 기업 소재지이지 신청자 거주지가 아님",
      },
      before: {
        rule: "region_in",
        value: [
          { province: "인천광역시", city: "미추홀구" },
          { province: "서울특별시" },
          { province: "경기도" },
          { province: "인천광역시" },
          { province: "서울특별시" },
          { province: "인천광역시" },
        ],
      },
      after: {
        rule: "region_in",
        value: [{ province: "인천광역시", city: "미추홀구" }],
      },
    },
    aggregate: {
      totalMOISRecords: totalRecords,
      totalFieldsProcessed: fieldsProcessed,
      totalRecordsWithRegionRuleBefore: beforeAgg.recordsWithRule,
      totalRecordsWithRegionRuleAfter: afterAgg.recordsWithRule,
      totalRegionSpecsBefore: beforeAgg.totalSpecs,
      totalRegionSpecsAfter: afterAgg.totalSpecs,
      affectedFieldCount: fieldDiffs.length,
      affectedRecordCount: affectedRecordIds.size,
      totalRemovedSpecCount: totalRemovedSpecs,
      totalAddedSpecCount: totalAddedSpecs,
      newlyEmptyFieldCount: newlyEmptyFieldDiffs.length,
      newlyEmptyFieldServiceIds: newlyEmptyFieldDiffs.map((d) => `${d.serviceId}/${d.field}`),
    },
    removalClassification: {
      totalRemovedSpecsClassified: classified.length,
      categoryCounts,
      categoryDefinitions: {
        A: "confirmed false residence spec (employer/interview/school/facility/etc. location incorrectly absorbed into region_in)",
        B: "valid residence spec accidentally removed (a residence marker exists nearby in the source text but the mention fell outside the new proximity/clause-binding window)",
        C: "ambiguous / needs human review (heuristic could not confidently classify)",
      },
      note:
        "Category label is an AUTOMATED heuristic (keyword-window scan), applied uniformly and disclosed as such — NOT a claim of manual review for every one of the counts above. The stratified samples below (up to 15 per category, deterministic — sorted by serviceId) include full source text for actual human verification.",
      sampleA: sampleCategory("A", 15),
      sampleB: sampleCategory("B", 15),
      sampleC: sampleCategory("C", 15),
    },
    knownDocumentedRecallLoss: {
      serviceId: "135200005017",
      note:
        "한국형 상병수당 시범사업 — 14-region pilot-program list spanning 3 separate ○-clauses, with the only residence signal ('시범사업 지역 거주') an anaphoric back-reference in a LATER, separate ○-clause. Genuinely far from every region mention both by character distance and ○-clause boundary — same shape as the confirmed false positive this checkpoint fixes, so the fix necessarily also declines to guess this indirect reference. See __tests__/fixtures/regionGoldSampleReal.ts for the updated fixture expectation and full rationale.",
    },
    eligibilitySafety: {
      unexpectedNonRegionMismatchCount,
      unexpectedNonRegionMismatchSamples,
      requirement: "unexpectedNonRegionMismatchCount must be 0 — this fix must only ever change the residence/region_in rule, never any other eligibility dimension.",
    },
  };

  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`Written to ${ARTIFACT_PATH}`);
  console.log(`\naffectedFieldCount=${fieldDiffs.length} affectedRecordCount=${affectedRecordIds.size}`);
  console.log(`totalRemovedSpecs=${totalRemovedSpecs} totalAddedSpecs=${totalAddedSpecs}`);
  console.log(`newlyEmptyFieldCount=${newlyEmptyFieldDiffs.length}`);
  console.log(`categoryCounts=`, categoryCounts);
  console.log(`unexpectedNonRegionMismatchCount=${unexpectedNonRegionMismatchCount}`);
}

main();
