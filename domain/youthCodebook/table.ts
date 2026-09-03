import type { YouthCodeFamily } from "./types";

/**
 * Versioned 온통청년(Youth Center) Open API official codebook, transcribed
 * verbatim from `API코드정보.xlsx`'s `코드정보` sheet (see `provenance.ts`).
 *
 * Only the 6 families with eligibility-relevance are promoted here (the
 * XLSX has 11 total; the other 5 — `pvsnInstGroupCd`, `plcyPvsnMthdCd`,
 * `plcyAprvSttsCd`, `aplyPrdSeCd`, `bizPrdSeCd` — describe policy metadata
 * like approval workflow state or provision method, not applicant
 * eligibility, and are out of scope for `YouthAdapter.ts`'s rule-building.
 * The full 11-family transcription remains available in
 * `scripts/auditYouthCodebookFrozen.ts` for audit purposes).
 *
 * `implementationStatus` per code was decided during the Phase 4-A audit
 * (docs/youth-codebook-phase4-audit.md, §6-§10) and FINALIZED with several
 * corrections during Phase 4-B review — see `compatibility.ts` for the
 * actual PASS/FAIL/UNKNOWN mapping logic for every "safe" code, and the
 * per-family comments below for why each "unresolved" code stays
 * unresolved. This table is the single source of truth for "is this code
 * known, and is it safe to build a rule from" — `compatibility.ts` never
 * hardcodes a code string outside of this table's `implementationStatus`
 * plus its own compat-spec maps.
 */
export const YOUTH_CODEBOOK: YouthCodeFamily[] = [
  {
    apiField: "mrgSttsCd",
    familyId: "0055",
    // Damoa MaritalStatus is 4-way (single/married/divorced/widowed); the
    // official codebook is 3-way and has NO code for 이혼/사별. See
    // compatibility.ts's MRG_STTS_CD_COMPAT for the corrected mapping:
    // divorced/widowed resolve to UNKNOWN against both 0055001 and
    // 0055002, never FAIL (Phase 4-B §6 correction to the Phase 4-A audit,
    // which had proposed FAIL for the 0055002/미혼 case).
    entries: [
      { code: "0055001", label: "기혼", implementationStatus: "safe" },
      { code: "0055002", label: "미혼", implementationStatus: "safe" },
      { code: "0055003", label: "제한없음", implementationStatus: "unrestricted" },
    ],
  },
  {
    apiField: "earnCndSeCd",
    familyId: "0043",
    // 0043002(연소득) is "safe" via the existing buildIncomeRule() structured
    // min/max path (unchanged behavior, only provenance updated per §11).
    // 0043003(기타) is always free-text-only (earnEtcCn) per the Phase 4-A
    // cross-check — never structured, stays unresolved.
    entries: [
      { code: "0043001", label: "무관", implementationStatus: "unrestricted" },
      { code: "0043002", label: "연소득", implementationStatus: "safe" },
      { code: "0043003", label: "기타", implementationStatus: "unresolved" },
    ],
  },
  {
    apiField: "jobCd",
    familyId: "0013",
    entries: [
      { code: "0013001", label: "재직자", implementationStatus: "safe" },
      { code: "0013002", label: "자영업자", implementationStatus: "safe" },
      { code: "0013003", label: "미취업자", implementationStatus: "safe" },
      { code: "0013004", label: "프리랜서", implementationStatus: "safe" },
      // 일용근로자: narrower than any EmploymentStatus value — mapping to
      // "employed" would be a guess. UNRESOLVED (Phase 4-B §7).
      { code: "0013005", label: "일용근로자", implementationStatus: "unresolved" },
      // (예비)창업자: real catalog text is consistently about people who have
      // NOT yet started a business — semantically opposite of
      // self_employed/businessOwner. Must NOT be mapped to either. UNRESOLVED.
      { code: "0013006", label: "(예비)창업자", implementationStatus: "unresolved" },
      { code: "0013007", label: "단기근로자", implementationStatus: "unresolved" },
      // 영농종사자: real text explicitly excludes registered business owners
      // ("사업자등록을 하고 사업체를 경영하는 자 제외") — not self_employed. UNRESOLVED.
      { code: "0013008", label: "영농종사자", implementationStatus: "unresolved" },
      { code: "0013009", label: "기타", implementationStatus: "unresolved" },
      { code: "0013010", label: "제한없음", implementationStatus: "unrestricted" },
    ],
  },
  {
    apiField: "schoolCd",
    familyId: "0049",
    entries: [
      { code: "0049001", label: "고졸 미만", implementationStatus: "unresolved" },
      { code: "0049002", label: "고교 재학", implementationStatus: "unresolved" },
      { code: "0049003", label: "고졸 예정", implementationStatus: "unresolved" },
      // 고교 졸업: a university/graduate_school profile must NOT be assumed to
      // satisfy this (over-qualification exclusions are common in entry-level
      // programs targeting this code — see real example 20260522005400213218).
      { code: "0049004", label: "고교 졸업", implementationStatus: "unresolved" },
      { code: "0049005", label: "대학 재학", implementationStatus: "safe" },
      // 대졸 예정: Phase 4-A's audit proposal (university=>PASS) was WRONG —
      // Damoa's `university` means the whole currently-enrolled undergrad
      // population (freshman..graduation-expected), a strict SUPERSET of
      // "대졸 예정". university vs 대졸예정 must resolve UNKNOWN, not PASS.
      // Corrected and left unresolved in Phase 4-B (§8).
      { code: "0049006", label: "대졸 예정", implementationStatus: "unresolved" },
      { code: "0049007", label: "대학 졸업", implementationStatus: "safe" },
      // 석·박사: real catalog text usage is MIXED (currently-enrolled grad
      // students, already-graduated post-docs, and skill-level "석박사 인재"
      // framing all appear) — does not cleanly equate to Damoa's
      // "graduate_school" (currently enrolled). Left unresolved per explicit
      // Phase 4-B verification instruction (§8).
      { code: "0049008", label: "석·박사", implementationStatus: "unresolved" },
      { code: "0049009", label: "기타", implementationStatus: "unresolved" },
      { code: "0049010", label: "제한없음", implementationStatus: "unrestricted" },
    ],
  },
  {
    apiField: "sbizCd",
    familyId: "0014",
    // Every specific code is UNRESOLVED/UNSUPPORTED per the Phase 4-A audit
    // (§9): 0014001(중소기업) is company-vs-employee ambiguous, 0014002(여성)/
    // 0014003(기초생활수급자)/0014005(장애인)/0014006(농업인)/0014007(군인)/
    // 0014008(지역인재) have no matching Damoa profile field, and 0014004
    // (한부모가정) is a SCOPE MISMATCH against `singleParentFamily` (that
    // field means family-membership, not "applicant is themself the single
    // parent") — do not reuse it. No new rules for any sbizCd code this
    // phase (§9 explicit instruction).
    entries: [
      { code: "0014001", label: "중소기업", implementationStatus: "unresolved" },
      { code: "0014002", label: "여성", implementationStatus: "unresolved" },
      { code: "0014003", label: "기초생활수급자", implementationStatus: "unresolved" },
      { code: "0014004", label: "한부모가정", implementationStatus: "unresolved" },
      { code: "0014005", label: "장애인", implementationStatus: "unresolved" },
      { code: "0014006", label: "농업인", implementationStatus: "unresolved" },
      { code: "0014007", label: "군인", implementationStatus: "unresolved" },
      { code: "0014008", label: "지역인재", implementationStatus: "unresolved" },
      { code: "0014009", label: "기타", implementationStatus: "unresolved" },
      { code: "0014010", label: "제한없음", implementationStatus: "unrestricted" },
    ],
  },
  {
    apiField: "plcyMajorCd",
    familyId: "0011",
    // No academic-major profile field exists in Damoa today (types/profile.ts
    // has no subject-matter field) — every specific code stays unresolved;
    // no new profile field/UI proposed this phase (§10).
    entries: [
      { code: "0011001", label: "인문계열", implementationStatus: "unresolved" },
      { code: "0011002", label: "사회계열", implementationStatus: "unresolved" },
      { code: "0011003", label: "상경계열", implementationStatus: "unresolved" },
      { code: "0011004", label: "이학계열", implementationStatus: "unresolved" },
      { code: "0011005", label: "공학계열", implementationStatus: "unresolved" },
      { code: "0011006", label: "예체능계열", implementationStatus: "unresolved" },
      { code: "0011007", label: "농산업계열", implementationStatus: "unresolved" },
      { code: "0011008", label: "기타", implementationStatus: "unresolved" },
      { code: "0011009", label: "제한없음", implementationStatus: "unrestricted" },
    ],
  },
];

const codebookByField = new Map<string, YouthCodeFamily>(YOUTH_CODEBOOK.map((f) => [f.apiField, f]));

export function getYouthCodeFamily(apiField: string): YouthCodeFamily | undefined {
  return codebookByField.get(apiField);
}

export function getYouthCodeEntry(apiField: string, code: string) {
  return codebookByField.get(apiField)?.entries.find((e) => e.code === code);
}
