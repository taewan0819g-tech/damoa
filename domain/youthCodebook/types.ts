/**
 * Types for the versioned 온통청년(Youth Center) Open API official codebook
 * module (see `provenance.ts` for source/verification details and
 * `table.ts` for the actual transcribed data).
 */

/**
 * Per-code disposition, decided during the Phase 4-A audit
 * (docs/youth-codebook-phase4-audit.md) and corrected/finalized during
 * Phase 4-B:
 *  - "unrestricted": the code IS the family's own 제한없음 (no-restriction)
 *    value — never emits a rule.
 *  - "safe": a defensible, deterministic PASS/FAIL/UNKNOWN compatibility
 *    mapping onto an existing Damoa profile field exists and is wired into
 *    `compatibility.ts` — may emit a rule.
 *  - "unresolved": no safe mapping exists yet (no matching Damoa profile
 *    concept, or the mapping would require guessing/inference the source
 *    data doesn't support). Never emits a rule. This is the conservative
 *    default for any code not explicitly marked otherwise.
 */
export type YouthCodeImplementationStatus = "unrestricted" | "safe" | "unresolved";

export interface YouthCodeEntry {
  code: string;
  /** Official Korean label, transcribed verbatim from the XLSX. */
  label: string;
  implementationStatus: YouthCodeImplementationStatus;
}

export interface YouthCodeFamily {
  /** The raw 온통청년 API field name this family applies to (e.g. "mrgSttsCd"). */
  apiField: string;
  /** The XLSX family/group code (e.g. "0055"). */
  familyId: string;
  entries: YouthCodeEntry[];
}

export interface YouthCodebookProvenance {
  source: string;
  sourceType: "official_xlsx";
  sourceFilename: string;
  sourceSha256: string;
  sizeBytes: number;
  sheet: string;
  totalRows: number;
  dataRows: number;
  verifiedAt: string;
}
