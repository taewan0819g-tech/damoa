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

/**
 * Phase 4-B pre-merge cleanup, §2: per-record, per-field classification for
 * reporting/`hasUnresolvedEligibility` purposes — deliberately DISTINCT from
 * `YouthCodeImplementationStatus` (which is a per-CODE, static decision made
 * once in `table.ts`). This type is the per-RECORD outcome of applying that
 * decision to one record's actual raw (possibly multi-code, possibly blank)
 * value for a field:
 *  - "missing": the raw field is blank/absent on this record.
 *  - "unrestricted": every code present is the family's own 제한없음
 *    (no-restriction) value. This must NEVER be counted as unresolved —
 *    it affirmatively means "no constraint", not "we don't know".
 *  - "fully_structured": at least one code is "safe" and none is
 *    "unresolved" — a rule was (or safely could be) built with no
 *    remaining uncertainty from this field.
 *  - "partially_structured_with_unresolved_branch": the raw value mixes at
 *    least one "safe" code with at least one "unresolved" code (e.g.
 *    jobCd = "재직자,예비창업자"). A useful rule may still get built from the
 *    safe branch (OR-composition treats the unresolved branch as a possible
 *    alternative, per `compatibility.ts`'s `aggregateVerdict`), but real
 *    uncertainty remains — `hasUnresolvedEligibility` must be true.
 *  - "unresolved": every code present is a known codebook code, but none is
 *    "safe" (e.g. jobCd = "(예비)창업자" alone, or any sbizCd/plcyMajorCd
 *    specific code). No rule is built; `hasUnresolvedEligibility` is true.
 *  - "unknown_code": at least one code present is NOT in the versioned
 *    codebook for this field at all (data-quality signal, or a code the
 *    XLSX transcription doesn't yet cover). No rule is built (per
 *    `compatibility.ts`'s "any unknown code blocks the WHOLE dimension"
 *    rule); `hasUnresolvedEligibility` is true.
 */
export type YouthDimensionStatus =
  | "missing"
  | "unrestricted"
  | "fully_structured"
  | "partially_structured_with_unresolved_branch"
  | "unresolved"
  | "unknown_code";

export interface YouthDimensionClassification {
  status: YouthDimensionStatus;
  /**
   * Whether this dimension, on this record, should contribute to the
   * benefit's overall `hasUnresolvedEligibility` flag. True for every
   * status except "missing" and "unrestricted".
   */
  hasUnresolvedEligibility: boolean;
}
