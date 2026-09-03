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
 * fully transcribed code→label rows below are recorded, so downstream
 * reviewers can verify this script's `YOUTH_CODEBOOK` constant against a
 * fresh copy of the same file without needing this repo to embed it.
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

// ---------------------------------------------------------------------------
// 1. Official codebook, transcribed verbatim from API코드정보.xlsx's
//    "코드정보" sheet (70 rows incl. header, 69 data rows, 0 duplicates,
//    0 blanks — verified via openpyxl with data_only=True). `zipCd` is
//    confirmed ABSENT from this sheet; see the separate zipCd provenance
//    note near ZIP_CD_PROVENANCE below.
// ---------------------------------------------------------------------------

const CODEBOOK_PROVENANCE = {
  source: "온통청년(Youth Center) Open API 코드정의서",
  filename: "API코드정보.xlsx",
  sha256: "81cd89ddc7bd49dfa9e53dec4f093bc8372d241505b5e8374cbfaf018245a5ef",
  sizeBytes: 21213,
  sheet: "코드정보",
  totalRows: 70,
  dataRows: 69,
  duplicates: 0,
  blanks: 0,
  verifiedAt: "2026-09-03",
} as const;

interface CodeEntry {
  code: string;
  label: string;
}

interface CodeFamily {
  /** The raw API field name this family applies to (e.g. "mrgSttsCd"). */
  apiField: string;
  /** The XLSX family/group code (e.g. "0055"). */
  familyId: string;
  entries: CodeEntry[];
}

const YOUTH_CODEBOOK: CodeFamily[] = [
  {
    apiField: "pvsnInstGroupCd",
    familyId: "0054",
    entries: [
      { code: "0054001", label: "중앙부처" },
      { code: "0054002", label: "지자체" },
    ],
  },
  {
    apiField: "plcyPvsnMthdCd",
    familyId: "0042",
    entries: [
      { code: "0042001", label: "인프라 구축" },
      { code: "0042002", label: "프로그램" },
      { code: "0042003", label: "직접대출" },
      { code: "0042004", label: "공공기관" },
      { code: "0042005", label: "계약(위탁운영)" },
      { code: "0042006", label: "보조금" },
      { code: "0042007", label: "대출보증" },
      { code: "0042008", label: "공적보험" },
      { code: "0042009", label: "조세지출" },
      { code: "0042010", label: "바우처" },
      { code: "0042011", label: "정보제공" },
      { code: "0042012", label: "경제적 규제" },
      { code: "0042013", label: "기타" },
    ],
  },
  {
    apiField: "plcyAprvSttsCd",
    familyId: "0044",
    entries: [
      { code: "0044001", label: "신청" },
      { code: "0044002", label: "승인" },
      { code: "0044003", label: "반려" },
      { code: "0044004", label: "임시저장" },
    ],
  },
  {
    apiField: "aplyPrdSeCd",
    familyId: "0057",
    entries: [
      { code: "0057001", label: "특정기간" },
      { code: "0057002", label: "상시" },
      { code: "0057003", label: "마감" },
    ],
  },
  {
    apiField: "bizPrdSeCd",
    familyId: "0056",
    entries: [
      { code: "0056001", label: "특정기간" },
      { code: "0056002", label: "기타" },
    ],
  },
  {
    apiField: "mrgSttsCd",
    familyId: "0055",
    entries: [
      { code: "0055001", label: "기혼" },
      { code: "0055002", label: "미혼" },
      { code: "0055003", label: "제한없음" },
    ],
  },
  {
    apiField: "earnCndSeCd",
    familyId: "0043",
    entries: [
      { code: "0043001", label: "무관" },
      { code: "0043002", label: "연소득" },
      { code: "0043003", label: "기타" },
    ],
  },
  {
    apiField: "plcyMajorCd",
    familyId: "0011",
    entries: [
      { code: "0011001", label: "인문계열" },
      { code: "0011002", label: "사회계열" },
      { code: "0011003", label: "상경계열" },
      { code: "0011004", label: "이학계열" },
      { code: "0011005", label: "공학계열" },
      { code: "0011006", label: "예체능계열" },
      { code: "0011007", label: "농산업계열" },
      { code: "0011008", label: "기타" },
      { code: "0011009", label: "제한없음" },
    ],
  },
  {
    apiField: "jobCd",
    familyId: "0013",
    entries: [
      { code: "0013001", label: "재직자" },
      { code: "0013002", label: "자영업자" },
      { code: "0013003", label: "미취업자" },
      { code: "0013004", label: "프리랜서" },
      { code: "0013005", label: "일용근로자" },
      { code: "0013006", label: "(예비)창업자" },
      { code: "0013007", label: "단기근로자" },
      { code: "0013008", label: "영농종사자" },
      { code: "0013009", label: "기타" },
      { code: "0013010", label: "제한없음" },
    ],
  },
  {
    apiField: "schoolCd",
    familyId: "0049",
    entries: [
      { code: "0049001", label: "고졸 미만" },
      { code: "0049002", label: "고교 재학" },
      { code: "0049003", label: "고졸 예정" },
      { code: "0049004", label: "고교 졸업" },
      { code: "0049005", label: "대학 재학" },
      { code: "0049006", label: "대졸 예정" },
      { code: "0049007", label: "대학 졸업" },
      { code: "0049008", label: "석·박사" },
      { code: "0049009", label: "기타" },
      { code: "0049010", label: "제한없음" },
    ],
  },
  {
    apiField: "sbizCd",
    familyId: "0014",
    entries: [
      { code: "0014001", label: "중소기업" },
      { code: "0014002", label: "여성" },
      { code: "0014003", label: "기초생활수급자" },
      { code: "0014004", label: "한부모가정" },
      { code: "0014005", label: "장애인" },
      { code: "0014006", label: "농업인" },
      { code: "0014007", label: "군인" },
      { code: "0014008", label: "지역인재" },
      { code: "0014009", label: "기타" },
      { code: "0014010", label: "제한없음" },
    ],
  },
];

/** zipCd has NO entry in the official 코드정보 sheet — its provenance is a
 * separate, external investigation (a public 법정동코드 cross-reference), not
 * this XLSX. Kept here only so the audit report can state its status
 * explicitly rather than silently omitting it. */
const ZIP_CD_PROVENANCE = {
  officialXlsxCoverage: false,
  note:
    "zipCd is ABSENT from API코드정보.xlsx's 코드정보 sheet (verified: 69/69 " +
    "data rows checked, no zipCd-named family). Its raw 5-digit values were " +
    "instead cross-checked against a public 법정동코드(administrative-district " +
    "code) table (e.g. 11680=서울 강남구, 41135=경기 성남시 분당구, " +
    "26440=부산 강서구, 50110=제주시, 36110=세종특별자치시 — all matched). " +
    "That proves the CODE SYSTEM's identity, not a safe production mapping: " +
    "Damoa's profile stores province/city TEXT, not 법정동코드, so turning " +
    "this into a rule requires a separate 법정동코드->Damoa-region crosswalk " +
    "that does not exist yet in this codebase. Treated as UNRESOLVED for " +
    "Phase 4 production-matching purposes.",
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
