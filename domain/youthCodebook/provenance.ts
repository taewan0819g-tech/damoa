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
 * rows checked, no zipCd-named family in any of the workbook's 4 sheets).
 * Its raw 5-digit values were instead cross-checked externally against a
 * public 법정동코드(administrative-district code) reference table (e.g.
 * 11680=서울 강남구, 41135=경기 성남시 분당구, 26440=부산 강서구, 50110=제주시,
 * 36110=세종특별자치시 — all matched). That proves the CODE SYSTEM's
 * identity, not a safe production mapping: Damoa's profile stores
 * province/city as free TEXT (`region_in`), not 법정동코드, so turning this
 * into a rule requires a separate 법정동코드 -> Damoa-region-text crosswalk
 * that does not exist in this codebase yet. See `compatibility.ts`'s
 * `ZIP_CD_NEXT_STEP` for the documented (not implemented) next-step path.
 */
export const ZIP_CD_PROVENANCE = {
  officialXlsxCoverage: false as const,
  note:
    "zipCd is ABSENT from API코드정보.xlsx's 코드정보 sheet. Its raw 5-digit " +
    "values are 법정동코드(administrative-district codes) confirmed via an " +
    "external public cross-reference, not the official XLSX. Treated as " +
    "UNRESOLVED for production rule-building purposes (Phase 4-B, §12).",
};
