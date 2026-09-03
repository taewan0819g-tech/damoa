/**
 * READ-ONLY Phase 4-A (온통청년 / Youth Center Open API code table) audit.
 *
 * Cross-references the OFFICIAL 온통청년 코드정의서 ("API코드정보.xlsx", provenance
 * recorded below) against the FROZEN Youth Center snapshot at
 * /tmp/youth_policy_full.json (2,745 records, same snapshot validated during
 * this phase's research). Does not call any production matching code and
 * does not modify any production file (adapters/youthCenter/YouthAdapter.ts,
 * lib/eligibility/candidateIndex.ts, lib/eligibility/ruleEngine.ts) — it only
 * computes per-field raw-value distributions from the real catalog and
 * diffs them against the transcribed official codebook, so the Phase 4-B
 * production-matching design (a separate, not-yet-started phase) can be
 * built FROM verified ground truth, not from empirical guessing.
 *
 * The XLSX source file itself is NOT committed to this repository (it may
 * contain distribution restrictions) — only its SHA-256, filename, and the
 * fully transcribed code→label rows are recorded (in
 * `domain/youthCodebook/officialTable.ts`, imported below — see Phase 4-B
 * pre-merge cleanup §5: this script used to carry a SECOND, independently
 * maintained copy of the same 11-family transcription, which has been
 * removed to eliminate drift risk. There is now exactly one place in this
 * codebase where these rows are transcribed), so downstream reviewers can
 * verify `OFFICIAL_YOUTH_CODEBOOK` against a fresh copy of the same file
 * without needing this repo to embed it.
 *
 * Run with:
 *   npx tsx scripts/auditYouthCodebookFrozen.ts
 *
 * Writes a full, uncapped JSON report to
 * /tmp/youth_codebook_phase4_audit.json (every distinct raw value per field,
 * its frequency, and its XLSX cross-reference status). stdout is capped to
 * top-N rows per field for readability only; the cap never affects the JSON
 * report or the reported counts.
 */

import fs from "node:fs";
import { OFFICIAL_YOUTH_CODEBOOK as YOUTH_CODEBOOK, type OfficialYouthCodeFamily } from "../domain/youthCodebook/officialTable";
import { YOUTH_CODEBOOK_PROVENANCE as CODEBOOK_PROVENANCE } from "../domain/youthCodebook/provenance";

// ---------------------------------------------------------------------------
// 1. Official codebook (11 families / 69 rows, verified via openpyxl with
//    data_only=True — 0 duplicates, 0 blanks). Imported from the single
//    centralized transcription in domain/youthCodebook/officialTable.ts
//    (Phase 4-B pre-merge cleanup, §5) rather than duplicated here. `zipCd`
//    is confirmed ABSENT from this sheet; see the separate zipCd provenance
//    note near ZIP_CD_PROVENANCE below.
// ---------------------------------------------------------------------------

type CodeFamily = OfficialYouthCodeFamily;

/** zipCd has NO entry in the official 코드정보 sheet — its provenance is a
 * separate, external investigation, not this XLSX. Kept here only so the
 * audit report can state its status explicitly rather than silently
 * omitting it. (Terminology corrected during the Phase 4-B pre-merge
 * cleanup, §4 — see domain/youthCodebook/provenance.ts's
 * `ZIP_CD_PROVENANCE`, which this mirrors.) */
const ZIP_CD_PROVENANCE = {
  officialXlsxCoverage: false,
  note:
    "zipCd is ABSENT from API코드정보.xlsx's 코드정보 sheet (verified: 69/69 " +
    "data rows checked, no zipCd-named family). It is a 5-digit Youth " +
    "Center region code; observed values are consistent with 시군구-level " +
    "administrative-region codes, but the exact official code-system " +
    "identity has not yet been verified from an authoritative Youth " +
    "Center source. Regardless, Damoa's profile stores province/city as " +
    "TEXT, not a numeric code, so turning this into a rule requires a " +
    "separate, verified region-code -> Damoa-region crosswalk that does " +
    "not exist yet in this codebase. Treated as UNRESOLVED for Phase 4 " +
    "production-matching purposes.",
} as const;

const codebookByField = new Map<string, CodeFamily>(YOUTH_CODEBOOK.map((f) => [f.apiField, f]));

// ---------------------------------------------------------------------------
// 2. Load + validate the frozen snapshot.
// ---------------------------------------------------------------------------

interface YouthRawRecord {
  plcyNo: string;
  plcyNm?: string;
  mrgSttsCd?: string;
  jobCd?: string;
  schoolCd?: string;
  sbizCd?: string;
  plcyMajorCd?: string;
  earnCndSeCd?: string;
  earnMinAmt?: string;
  earnMaxAmt?: string;
  earnEtcCn?: string;
  zipCd?: string;
  plcyExplnCn?: string;
  addAplyQlfcCndCn?: string;
  ptcpPrpTrgtCn?: string;
  [key: string]: unknown;
}

const SNAPSHOT_PATH = "/tmp/youth_policy_full.json";
const records: YouthRawRecord[] = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
console.log(`Loaded frozen Youth Center snapshot: ${records.length} records from ${SNAPSHOT_PATH}`);
if (records.length === 0) {
  throw new Error("Frozen snapshot is empty — aborting audit.");
}

// ---------------------------------------------------------------------------
// 3. Generic per-field, multi-code-aware frequency audit.
// ---------------------------------------------------------------------------

/** Fields whose raw values may contain multiple comma-delimited codes. */
const MULTI_CODE_FIELDS = new Set(["jobCd", "schoolCd", "sbizCd", "plcyMajorCd"]);

interface FieldAudit {
  apiField: string;
  total: number;
  populated: number;
  blank: number;
  /** Frequency of the exact raw string as returned by the API (may itself be a multi-code combo). */
  rawValueFrequency: Record<string, number>;
  /** For multi-code fields: frequency of each INDIVIDUAL code across all records (a record with 3 codes counts once per code). */
  individualCodeFrequency: Record<string, number>;
  distinctRawValues: number;
  distinctIndividualCodes: number;
  /** Raw codes observed in the snapshot but ABSENT from the official XLSX codebook for this field. */
  unknownCodesObserved: string[];
  /** Official XLSX codes for this field that were NEVER observed in the snapshot. */
  xlsxCodesNeverObserved: string[];
  /** Count of records whose raw value contains 2+ comma-delimited codes. */
  multiCodeRecordCount: number;
  /** Max number of codes seen in a single record's raw value. */
  maxCodesInOneRecord: number;
}

function auditField(apiField: string): FieldAudit {
  const family = codebookByField.get(apiField);
  const officialCodes = new Set((family?.entries ?? []).map((e) => e.code));
  const isMulti = MULTI_CODE_FIELDS.has(apiField);

  let populated = 0;
  let blank = 0;
  const rawValueFrequency = new Map<string, number>();
  const individualCodeFrequency = new Map<string, number>();
  const observedCodes = new Set<string>();
  let multiCodeRecordCount = 0;
  let maxCodesInOneRecord = 0;

  for (const r of records) {
    const raw = (r[apiField] as string | undefined) ?? "";
    if (raw.trim() === "") {
      blank++;
      continue;
    }
    populated++;
    rawValueFrequency.set(raw, (rawValueFrequency.get(raw) ?? 0) + 1);

    const parts = isMulti ? raw.split(",").map((p) => p.trim()).filter(Boolean) : [raw.trim()];
    if (parts.length > 1) multiCodeRecordCount++;
    maxCodesInOneRecord = Math.max(maxCodesInOneRecord, parts.length);
    for (const code of parts) {
      observedCodes.add(code);
      individualCodeFrequency.set(code, (individualCodeFrequency.get(code) ?? 0) + 1);
    }
  }

  const unknownCodesObserved = [...observedCodes].filter((c) => !officialCodes.has(c)).sort();
  const xlsxCodesNeverObserved = [...officialCodes].filter((c) => !observedCodes.has(c)).sort();

  return {
    apiField,
    total: records.length,
    populated,
    blank,
    rawValueFrequency: Object.fromEntries([...rawValueFrequency.entries()].sort((a, b) => b[1] - a[1])),
    individualCodeFrequency: Object.fromEntries(
      [...individualCodeFrequency.entries()].sort((a, b) => b[1] - a[1])
    ),
    distinctRawValues: rawValueFrequency.size,
    distinctIndividualCodes: individualCodeFrequency.size,
    unknownCodesObserved,
    xlsxCodesNeverObserved,
    multiCodeRecordCount,
    maxCodesInOneRecord,
  };
}

const AUDITED_FIELDS = ["mrgSttsCd", "jobCd", "schoolCd", "sbizCd", "plcyMajorCd", "earnCndSeCd"] as const;
const fieldAudits: Record<string, FieldAudit> = {};
for (const f of AUDITED_FIELDS) {
  fieldAudits[f] = auditField(f);
}

// ---------------------------------------------------------------------------
// 4. zipCd — no XLSX codebook entry, so audited separately (no unknown/never-
//    observed cross-reference against a codebook that doesn't cover it).
// ---------------------------------------------------------------------------

interface ZipCdAudit {
  total: number;
  populated: number;
  blank: number;
  distinctRawCombos: number;
  distinctIndividualCodes: number;
  multiCodeRecordCount: number;
  minCodesInOneRecord: number;
  maxCodesInOneRecord: number;
  singleCodeRecordCount: number;
  codeLengthFrequency: Record<number, number>;
  topIndividualCodeFrequency: Record<string, number>;
}

function auditZipCd(): ZipCdAudit {
  let populated = 0;
  let blank = 0;
  const rawCombos = new Set<string>();
  const individualCodeFrequency = new Map<string, number>();
  let multiCodeRecordCount = 0;
  let singleCodeRecordCount = 0;
  let minCodes = Number.POSITIVE_INFINITY;
  let maxCodes = 0;
  const codeLengthFrequency = new Map<number, number>();

  for (const r of records) {
    const raw = (r.zipCd as string | undefined) ?? "";
    if (raw.trim() === "") {
      blank++;
      continue;
    }
    populated++;
    rawCombos.add(raw);
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    minCodes = Math.min(minCodes, parts.length);
    maxCodes = Math.max(maxCodes, parts.length);
    if (parts.length > 1) multiCodeRecordCount++;
    if (parts.length === 1) singleCodeRecordCount++;
    for (const code of parts) {
      individualCodeFrequency.set(code, (individualCodeFrequency.get(code) ?? 0) + 1);
      codeLengthFrequency.set(code.length, (codeLengthFrequency.get(code.length) ?? 0) + 1);
    }
  }

  const topIndividualCodeFrequency = Object.fromEntries(
    [...individualCodeFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  );

  return {
    total: records.length,
    populated,
    blank,
    distinctRawCombos: rawCombos.size,
    distinctIndividualCodes: individualCodeFrequency.size,
    multiCodeRecordCount,
    minCodesInOneRecord: Number.isFinite(minCodes) ? minCodes : 0,
    maxCodesInOneRecord: maxCodes,
    singleCodeRecordCount,
    codeLengthFrequency: Object.fromEntries(codeLengthFrequency),
    topIndividualCodeFrequency,
  };
}

const zipCdAudit = auditZipCd();

// ---------------------------------------------------------------------------
// 5. earnCndSeCd cross-check against earnMinAmt/earnMaxAmt/earnEtcCn — did
//    the empirical pre-XLSX understanding ("0043001"=no condition/무관,
//    "0043002"=structured min/max/연소득, "0043003"=free-text/기타) actually
//    line up with the official labels once cross-referenced against the
//    real amount/text fields per code?
// ---------------------------------------------------------------------------

interface EarnCndCrossCheck {
  code: string;
  officialLabel: string;
  recordCount: number;
  hasMinAmtGt0: number;
  hasMaxAmtGt0: number;
  bothZeroOrBlank: number;
  hasNonBlankEtcCn: number;
  sampleEtcCn: string[];
}

function crossCheckEarnCndSeCd(): EarnCndCrossCheck[] {
  const family = codebookByField.get("earnCndSeCd");
  const results: EarnCndCrossCheck[] = [];
  for (const entry of family?.entries ?? []) {
    const matching = records.filter((r) => r.earnCndSeCd === entry.code);
    const hasMinAmtGt0 = matching.filter((r) => Number(r.earnMinAmt ?? 0) > 0).length;
    const hasMaxAmtGt0 = matching.filter((r) => Number(r.earnMaxAmt ?? 0) > 0).length;
    const bothZeroOrBlank = matching.filter(
      (r) => Number(r.earnMinAmt ?? 0) === 0 && Number(r.earnMaxAmt ?? 0) === 0
    ).length;
    const withEtcCn = matching.filter((r) => (r.earnEtcCn ?? "").trim() !== "");
    results.push({
      code: entry.code,
      officialLabel: entry.label,
      recordCount: matching.length,
      hasMinAmtGt0,
      hasMaxAmtGt0,
      bothZeroOrBlank,
      hasNonBlankEtcCn: withEtcCn.length,
      sampleEtcCn: withEtcCn.slice(0, 5).map((r) => (r.earnEtcCn ?? "").slice(0, 120)),
    });
  }
  return results;
}

const earnCndCrossCheck = crossCheckEarnCndSeCd();

// ---------------------------------------------------------------------------
// 6. Console summary (capped for readability; full detail goes to the JSON
//    report written in section 7).
// ---------------------------------------------------------------------------

console.log(`\n=== Codebook provenance ===`);
console.log(CODEBOOK_PROVENANCE);

for (const f of AUDITED_FIELDS) {
  const a = fieldAudits[f];
  console.log(`\n=== ${f} (family ${codebookByField.get(f)?.familyId}) ===`);
  console.log(
    `total=${a.total} populated=${a.populated} blank=${a.blank} distinctRawValues=${a.distinctRawValues} ` +
      `distinctIndividualCodes=${a.distinctIndividualCodes} multiCodeRecords=${a.multiCodeRecordCount} ` +
      `maxCodesInOneRecord=${a.maxCodesInOneRecord}`
  );
  console.log(`unknownCodesObserved (not in XLSX): ${JSON.stringify(a.unknownCodesObserved)}`);
  console.log(`xlsxCodesNeverObserved (in XLSX, 0 hits in snapshot): ${JSON.stringify(a.xlsxCodesNeverObserved)}`);
  console.log(`top individual codes:`);
  for (const [code, count] of Object.entries(a.individualCodeFrequency).slice(0, 10)) {
    const label = codebookByField.get(f)?.entries.find((e) => e.code === code)?.label ?? "(UNKNOWN CODE)";
    console.log(`  ${code} (${label}): ${count}`);
  }
}

console.log(`\n=== zipCd (no XLSX coverage) ===`);
console.log(zipCdAudit);
console.log(ZIP_CD_PROVENANCE);

console.log(`\n=== earnCndSeCd cross-check vs earnMinAmt/earnMaxAmt/earnEtcCn ===`);
for (const r of earnCndCrossCheck) {
  console.log(
    `${r.code} (${r.officialLabel}): records=${r.recordCount} hasMinAmt>0=${r.hasMinAmtGt0} ` +
      `hasMaxAmt>0=${r.hasMaxAmtGt0} bothZeroOrBlank=${r.bothZeroOrBlank} hasNonBlankEtcCn=${r.hasNonBlankEtcCn}`
  );
  for (const s of r.sampleEtcCn) console.log(`    etcCn sample: ${s}`);
}

// ---------------------------------------------------------------------------
// 7. Full uncapped JSON report.
// ---------------------------------------------------------------------------

const OUTPUT_PATH = "/tmp/youth_codebook_phase4_audit.json";
fs.writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      codebookProvenance: CODEBOOK_PROVENANCE,
      codebook: YOUTH_CODEBOOK,
      zipCdProvenance: ZIP_CD_PROVENANCE,
      snapshot: { path: SNAPSHOT_PATH, recordCount: records.length },
      fieldAudits,
      zipCdAudit,
      earnCndSeCdCrossCheck: earnCndCrossCheck,
    },
    null,
    2
  )
);
console.log(`\nFull uncapped audit report written to ${OUTPUT_PATH}`);
