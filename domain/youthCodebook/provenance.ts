import type { YouthCodebookProvenance } from "./types";

/**
 * Provenance for the official 온통청년(Youth Center) Open API 코드정의서
 * ("API코드정보.xlsx"). Verified live against the real workbook — see the
 * Phase 4-A audit at docs/youth-codebook-phase4-audit.md for the full
 * methodology (openpyxl, data_only=True, cross-referenced against the
 * frozen 2,745-record /tmp/youth_policy_full.json snapshot).
 *
 * The XLSX file itself is intentionally NOT committed to this repository
 * (it may carry distribution restrictions) — only its SHA-256, filename,
 * and the fully transcribed code->label rows (see `table.ts`) are recorded,
 * so a downstream reviewer can verify `YOUTH_CODEBOOK` against a fresh copy
 * of the same file without this repo needing to embed it.
 */
export const YOUTH_CODEBOOK_PROVENANCE: YouthCodebookProvenance = {
  source: "온통청년(Youth Center) Open API 공식 코드정의서",
  sourceType: "official_xlsx",
  sourceFilename: "API코드정보.xlsx",
  sourceSha256: "81cd89ddc7bd49dfa9e53dec4f093bc8372d241505b5e8374cbfaf018245a5ef",
  sizeBytes: 21213,
  sheet: "코드정보",
  totalRows: 70,
  dataRows: 69,
  verifiedAt: "2026-09-03",
};

/**
 * `zipCd` has NO entry in the official 코드정보 sheet (verified: 69/69 data
 * rows checked, no zipCd-named family in any of the workbook's 4 sheets) —
 * this XLSX-absence fact remains true and is NOT contradicted by anything
 * below. Its raw 5-digit values ARE, however, now RESOLVED against a
 * DIFFERENT, independently-authoritative source: the Korean government's
 * own 법정동코드 전체자료 dataset (checkpoint: Youth zipCd structured region
 * eligibility). All 261 distinct zipCd tokens observed in the frozen
 * 2,745-record Youth catalog snapshot were classified against that dataset
 * with zero unmapped tokens, and a `region_in` rule is now built from it in
 * production (`compatibility.ts`'s `buildYouthRegionRule`, wired into
 * `YouthAdapter.ts`'s `buildEligibility()`). See
 * `zipCdCrosswalk.ts`'s `YOUTH_ZIPCD_CROSSWALK_PROVENANCE` for the exact
 * source filename/hash, row counts, and the full classification breakdown
 * (plain leaf / subordinate-gu / parent-aggregate / historical).
 */
export const ZIP_CD_PROVENANCE = {
  officialXlsxCoverage: false as const,
  note:
    "zipCd is ABSENT from API코드정보.xlsx's 코드정보 sheet (this remains " +
    "true). It is a 5-digit region code now RESOLVED via a different, " +
    "independently-authoritative source — the government's 법정동코드 " +
    "전체자료 dataset — with zero unmapped tokens across all 261 observed " +
    "values; see zipCdCrosswalk.ts's YOUTH_ZIPCD_CROSSWALK_PROVENANCE for " +
    "the full provenance and compatibility.ts's buildYouthRegionRule for " +
    "the production region_in rule now built from it.",
};
