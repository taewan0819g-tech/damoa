import type { EducationStatus, EmploymentStatus, MaritalStatus } from "@/types/profile";
import type { EligibilityRule } from "@/types/benefit";
import { matchStatusCompat, type StatusCompatSpec } from "@/lib/eligibility/statusCompat";
import { getYouthCodeFamily } from "./table";

/**
 * Youth Center (온통청년) codebook -> Damoa profile compatibility mapping.
 *
 * This module owns EVERY code-keyed compatibility decision for the Youth
 * adapter (Phase 4-B, §1's explicit instruction: "do NOT duplicate code
 * mappings ad hoc inside YouthAdapter.ts"). `YouthAdapter.ts` only calls the
 * three `build*Rule` functions at the bottom of this file — it never
 * inspects a raw code string itself.
 *
 * Multi-code OR/whitelist semantics (Phase 4-A audit §5, corroborated by
 * real catalog evidence: mutually-exclusive-status combos, zero
 * co-occurrence with 제한없음, and "enumerate everything" combos acting as
 * de-facto 제한없음): a comma-delimited raw value means "the applicant
 * qualifies if ANY one of these codes is compatible with their profile
 * value" — not a new RuleEngine operator, just a single composed
 * `StatusCompatSpec` per rule (Phase 4-B §4).
 */

// ---------------------------------------------------------------------------
// Profile value domains (used to enumerate every possible profile value when
// composing an OR'd multi-code spec — see `composeOrStatusCompatSpec`).
// ---------------------------------------------------------------------------

const MARITAL_STATUS_DOMAIN: readonly MaritalStatus[] = ["single", "married", "divorced", "widowed"];
const EMPLOYMENT_STATUS_DOMAIN: readonly EmploymentStatus[] = [
  "employed",
  "unemployed",
  "self_employed",
  "freelancer",
  "student",
  "other",
];
const EDUCATION_STATUS_DOMAIN: readonly EducationStatus[] = [
  "high_school",
  "university",
  "graduate_school",
  "graduated",
  "not_applicable",
];

// ---------------------------------------------------------------------------
// Per-code compatibility specs. Only codes marked "safe" in table.ts appear
// here — every other code (unrestricted or unresolved) is deliberately
// absent, so a lookup miss is the correct signal for "this code contributes
// no PASS/FAIL information" everywhere below.
// ---------------------------------------------------------------------------

/**
 * mrgSttsCd (0055) -> MaritalStatus. Corrected per Phase 4-B §6: divorced
 * and widowed resolve to UNKNOWN against BOTH 기혼 and 미혼 — the official
 * codebook has no 이혼/사별 code, and Korean 미혼 means "never married", which
 * doesn't prove or disprove eligibility for someone who WAS married and no
 * longer is. This deliberately overrides the earlier Phase 4-A audit
 * proposal (which had suggested FAIL for divorced/widowed against 미혼) —
 * that was judged too aggressive: the codebook only affirmatively defines
 * 기혼, it doesn't prove every Youth policy treats divorced/widowed as
 * definitively incompatible with either target.
 */
const MRG_STTS_CD_COMPAT = new Map<string, StatusCompatSpec<MaritalStatus>>([
  // 기혼 (married-required).
  ["0055001", { passValues: ["married"], failValues: ["single"] }],
  // 미혼 (never-married-required).
  ["0055002", { passValues: ["single"], failValues: ["married"] }],
]);

/**
 * jobCd (0013) -> EmploymentStatus. Conservative per Phase 4-B §7 — only
 * 재직자/자영업자/미취업자/프리랜서 get any spec at all; every other code
 * (일용근로자, (예비)창업자, 단기근로자, 영농종사자, 기타) stays entirely
 * absent from this map (unresolved), and is NEVER mapped to `self_employed`
 * or any other value.
 */
const JOB_CD_COMPAT = new Map<string, StatusCompatSpec<EmploymentStatus>>([
  // 재직자 (currently employed).
  ["0013001", { passValues: ["employed"], failValues: ["unemployed"] }],
  // 자영업자 (self-employed/business owner). Deliberately NO failValues:
  // per §7, do not assume a generic employed/student/freelancer selection
  // means "not self-employed" — only include a failValue when genuine
  // incompatibility is independently defensible, which isn't established
  // here (Damoa's single-choice employmentStatus UI doesn't by itself prove
  // every non-self_employed choice is incompatible with a 자영업자 target).
  ["0013002", { passValues: ["self_employed"], failValues: [] }],
  // 미취업자 (must not be employed). `self_employed` included as FAIL: the
  // profile label for self_employed is "자영업" (actively running one's own
  // business) — an active working status, so it's defensible as
  // incompatible with "미취업" the same way `employed` is. `freelancer`/
  // `student`/`other` stay unmodeled (no catalog evidence either way).
  ["0013003", { passValues: ["unemployed"], failValues: ["employed", "self_employed"] }],
  // 프리랜서. No failValues — do not manufacture broad FAIL values from a
  // single-choice UI selection.
  ["0013004", { passValues: ["freelancer"], failValues: [] }],
]);

/**
 * schoolCd (0049) -> EducationStatus. Corrected per Phase 4-B §8 — the
 * Phase 4-A audit's "0049006(대졸 예정): university=>PASS" proposal was a
 * logical error and is NOT carried forward: Damoa's `university` means the
 * whole currently-enrolled undergraduate population (freshman through
 * graduation-expected), a strict SUPERSET of "대졸 예정" (soon-to-graduate).
 * A superset membership can never safely imply PASS for the narrower
 * subset — that must resolve UNKNOWN, so 0049006 is entirely absent from
 * this map. Same reasoning keeps 0049008(석·박사) absent: real catalog text
 * usage for that code is mixed (enrolled grad students, already-graduated
 * post-docs, and skill-level "석박사 인재" framing all appear), so it does
 * not cleanly equate to `graduate_school` (currently enrolled) either way.
 */
const SCHOOL_CD_COMPAT = new Map<string, StatusCompatSpec<EducationStatus>>([
  // 대학 재학 (currently enrolled undergraduate).
  ["0049005", { passValues: ["university"], failValues: ["graduate_school"] }],
  // 대학 졸업 (holds a bachelor's degree). No `university` failValue: a
  // current university student could be pursuing an additional bachelor's
  // after already holding one — not disprovable from `university` alone,
  // so left UNKNOWN rather than guessed FAIL.
  ["0049007", { passValues: ["graduate_school"], failValues: [] }],
]);

// ---------------------------------------------------------------------------
// §3: deterministic code-list parsing helper, shared by every field.
// ---------------------------------------------------------------------------

export interface ParsedYouthCodeList {
  /** Deduplicated, trimmed, non-blank codes, in first-seen order. */
  codes: string[];
  /** Codes present in the raw value that are NOT in the official codebook for this apiField at all. */
  unknownCodes: string[];
  /** True when the raw value has zero usable codes (blank/whitespace-only). */
  isBlank: boolean;
}

/**
 * Splits a raw Youth Center comma-delimited code-list field, trims each
 * token, drops blank tokens, and deduplicates — then cross-references every
 * surviving code against the versioned codebook (`table.ts`) for this
 * `apiField`. Never silently drops a code the codebook doesn't recognize;
 * callers (the `build*Rule` functions below) treat any `unknownCodes` entry
 * as reason to leave the WHOLE dimension unresolved (§3: "if any specific
 * raw code is unknown to the versioned codebook: that dimension is
 * unresolved") rather than quietly proceeding with only the known codes.
 */
export function parseYouthCodeList(apiField: string, raw: string | undefined | null): ParsedYouthCodeList {
  if (!raw || raw.trim() === "") return { codes: [], unknownCodes: [], isBlank: true };

  const family = getYouthCodeFamily(apiField);
  const knownCodes = new Set((family?.entries ?? []).map((e) => e.code));

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    codes.push(trimmed);
  }

  const unknownCodes = codes.filter((c) => !knownCodes.has(c));
  return { codes, unknownCodes, isBlank: codes.length === 0 };
}

// ---------------------------------------------------------------------------
// §4: OR-aggregation of a multi-code list into a single StatusCompatSpec.
// ---------------------------------------------------------------------------

/**
 * For a single profile value, aggregates the per-code verdicts of `codes`
 * against `specByCode` using OR/whitelist semantics: PASS if ANY code
 * yields PASS for this value; else FAIL only if EVERY code yields FAIL;
 * otherwise UNKNOWN. A code absent from `specByCode` (unrestricted or
 * unresolved) always contributes "unknown" — which can never singlehandedly
 * produce a PASS, but DOES correctly prevent an aggregate FAIL as long as
 * at least one such code remains a possible alternative branch (this is
 * exactly the "unsupported code as a possible OR branch" safety property
 * required by Phase 4-B §7).
 */
function aggregateVerdict<T extends string>(
  value: T,
  codes: readonly string[],
  specByCode: ReadonlyMap<string, StatusCompatSpec<T>>
): "pass" | "fail" | "unknown" {
  if (codes.length === 0) return "unknown";
  let anyPass = false;
  let allFail = true;
  for (const code of codes) {
    const spec = specByCode.get(code);
    const verdict = spec ? matchStatusCompat(value, spec) : "unknown";
    if (verdict === "pass") anyPass = true;
    if (verdict !== "fail") allFail = false;
  }
  if (anyPass) return "pass";
  if (allFail) return "fail";
  return "unknown";
}

/**
 * Composes a single OR'd `StatusCompatSpec<T>` for a multi-code list, by
 * running `aggregateVerdict` over every possible value in `domain`. Returns
 * `undefined` when the resulting spec would be vacuous (no code in `codes`
 * contributed a PASS or FAIL for any domain value) — e.g. a code list
 * containing only unresolved/unrestricted codes — so the caller can skip
 * building a rule entirely rather than emitting an empty, no-op spec.
 */
export function composeOrStatusCompatSpec<T extends string>(
  codes: readonly string[],
  specByCode: ReadonlyMap<string, StatusCompatSpec<T>>,
  domain: readonly T[]
): StatusCompatSpec<T> | undefined {
  const passValues: T[] = [];
  const failValues: T[] = [];
  for (const value of domain) {
    const verdict = aggregateVerdict(value, codes, specByCode);
    if (verdict === "pass") passValues.push(value);
    else if (verdict === "fail") failValues.push(value);
  }
  if (passValues.length === 0 && failValues.length === 0) return undefined;
  return { passValues, failValues };
}

// ---------------------------------------------------------------------------
// Shared rule-building helper + three public wrappers (§14: every rule
// carries structured evidence back to the raw API field/value).
// ---------------------------------------------------------------------------

function buildStatusCompatRuleFromCodeList<T extends string>(
  ruleId: string,
  apiField: string,
  raw: string | undefined,
  profileField: string,
  specByCode: ReadonlyMap<string, StatusCompatSpec<T>>,
  domain: readonly T[]
): EligibilityRule | undefined {
  const parsed = parseYouthCodeList(apiField, raw);
  if (parsed.isBlank) return undefined;
  // §3: any code unknown to the versioned codebook leaves the WHOLE
  // dimension unresolved — never proceed with a partial known-codes-only
  // interpretation.
  if (parsed.unknownCodes.length > 0) return undefined;

  const spec = composeOrStatusCompatSpec(parsed.codes, specByCode, domain);
  if (!spec) return undefined;

  return {
    id: ruleId,
    field: profileField,
    operator: "status_compat",
    value: spec,
    required: true,
    evidence: { sourceField: apiField, sourceText: raw, extractionType: "structured_api" },
  };
}

export function buildMaritalStatusRule(mrgSttsCd: string | undefined): EligibilityRule | undefined {
  return buildStatusCompatRuleFromCodeList(
    "youth-marital",
    "mrgSttsCd",
    mrgSttsCd,
    "maritalStatus",
    MRG_STTS_CD_COMPAT,
    MARITAL_STATUS_DOMAIN
  );
}

export function buildEmploymentStatusRule(jobCd: string | undefined): EligibilityRule | undefined {
  return buildStatusCompatRuleFromCodeList(
    "youth-employment",
    "jobCd",
    jobCd,
    "employmentStatus",
    JOB_CD_COMPAT,
    EMPLOYMENT_STATUS_DOMAIN
  );
}

export function buildEducationStatusRule(schoolCd: string | undefined): EligibilityRule | undefined {
  return buildStatusCompatRuleFromCodeList(
    "youth-education",
    "schoolCd",
    schoolCd,
    "educationStatus",
    SCHOOL_CD_COMPAT,
    EDUCATION_STATUS_DOMAIN
  );
}

/**
 * §12: documented (NOT implemented) next step for `zipCd`. Confirmed absent
 * from the official XLSX (see `provenance.ts`'s `ZIP_CD_PROVENANCE`); its
 * raw values are 5-digit 법정동코드(administrative-district codes) — the
 * SAME code system used throughout Korean government open data, where the
 * first 5 digits identify a 시군구 (city/county/district) and the full
 * 10-digit code adds 읍면동-level granularity. A future crosswalk would
 * need to: (1) obtain the canonical MOIS 법정동코드 reference table (5-digit
 * 시군구 level is sufficient, no 10-digit table needed since `zipCd` values
 * are already 5 digits), (2) map each 시군구 code to the `{province, city}`
 * text pairs `region_in` already understands (`lib/eligibility/region.ts`),
 * and (3) build a `region_in` rule (not a new operator) from the parsed
 * code list using this module's same OR-composition pattern. Explicitly
 * out of scope for Phase 4-B — no frequency-based inference, no partial
 * crosswalk, per the task's instruction not to start this implementation
 * in the same run.
 */
export const ZIP_CD_NEXT_STEP =
  "zipCd values are 5-digit 법정동코드 (시군구-level administrative-district " +
  "codes, confirmed via external cross-reference — see provenance.ts). " +
  "Building a production rule requires a 법정동코드 -> Damoa region {province, " +
  "city} crosswalk that does not exist in this codebase yet; deferred to a " +
  "dedicated future checkpoint, not started in Phase 4-B.";
