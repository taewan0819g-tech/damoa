import type { YouthCodeFamily, YouthCodeImplementationStatus } from "./types";
import { getOfficialYouthCodeFamily } from "./officialTable";

/**
 * Versioned 온통청년(Youth Center) Open API official codebook, DERIVED from
 * the single authoritative label transcription in `officialTable.ts`
 * (Phase 4-B pre-merge cleanup, §5 — this file used to carry its own copy of
 * every code->label pair; now it only owns the `implementationStatus`
 * DECISION per code, and looks the label up from `officialTable.ts` instead
 * of re-typing it, so there is exactly one place in the codebase where the
 * official XLSX's code->label rows are transcribed).
 *
 * Only the 6 families with eligibility-relevance are promoted here (the
 * XLSX has 11 total; the other 5 — `pvsnInstGroupCd`, `plcyPvsnMthdCd`,
 * `plcyAprvSttsCd`, `aplyPrdSeCd`, `bizPrdSeCd` — describe policy metadata
 * like approval workflow state or provision method, not applicant
 * eligibility, and are out of scope for `YouthAdapter.ts`'s rule-building.
 * The full 11-family transcription lives in `officialTable.ts` and is used
 * directly by `scripts/auditYouthCodebookFrozen.ts` for audit purposes).
 *
 * `implementationStatus` per code was decided during the Phase 4-A audit
 * (docs/youth-codebook-phase4-audit.md, §6-§10) and FINALIZED with several
 * corrections during Phase 4-B — see `compatibility.ts` for the actual
 * PASS/FAIL/UNKNOWN mapping logic for every "safe" code, and the per-family
 * comments below for why each "unresolved" code stays unresolved. This
 * table is the single source of truth for "is this code known, and is it
 * safe to build a rule from" — `compatibility.ts` never hardcodes a code
 * string outside of this table's `implementationStatus` plus its own
 * compat-spec maps.
 *
 * A build-time invariant (`buildFamily` below) throws if a code present in
 * `officialTable.ts` for one of these 6 fields has no explicit
 * `implementationStatus` decision recorded, or vice versa — this keeps the
 * decision table and the official transcription from silently drifting out
 * of sync as either one changes.
 */

// ---------------------------------------------------------------------------
// Per-field, per-code implementationStatus decisions. Every code in each of
// these 6 families (per officialTable.ts) MUST appear here exactly once.
// ---------------------------------------------------------------------------

const MRG_STTS_CD_STATUS: Record<string, YouthCodeImplementationStatus> = {
  // Damoa MaritalStatus is 4-way (single/married/divorced/widowed); the
  // official codebook is 3-way and has NO code for 이혼/사별. See
  // compatibility.ts's MRG_STTS_CD_COMPAT for the corrected mapping:
  // divorced/widowed resolve to UNKNOWN against both 0055001 and 0055002,
  // never FAIL (Phase 4-B §6 correction to the Phase 4-A audit, which had
  // proposed FAIL for the 0055002/미혼 case).
  "0055001": "safe", // 기혼
  "0055002": "safe", // 미혼
  "0055003": "unrestricted", // 제한없음
};

const EARN_CND_SE_CD_STATUS: Record<string, YouthCodeImplementationStatus> = {
  // 0043002(연소득) is "safe" via the existing buildIncomeRule() structured
  // min/max path (unchanged behavior, only provenance updated per §11).
  // 0043003(기타) is always free-text-only (earnEtcCn) per the Phase 4-A
  // cross-check — never structured, stays unresolved.
  "0043001": "unrestricted", // 무관
  "0043002": "safe", // 연소득
  "0043003": "unresolved", // 기타
};

const JOB_CD_STATUS: Record<string, YouthCodeImplementationStatus> = {
  "0013001": "safe", // 재직자
  "0013002": "safe", // 자영업자
  "0013003": "safe", // 미취업자
  "0013004": "safe", // 프리랜서
  // 일용근로자: narrower than any EmploymentStatus value — mapping to
  // "employed" would be a guess. UNRESOLVED (Phase 4-B §7).
  "0013005": "unresolved", // 일용근로자
  // (예비)창업자: real catalog text is consistently about people who have
  // NOT yet started a business — semantically opposite of
  // self_employed/businessOwner. Must NOT be mapped to either. UNRESOLVED.
  "0013006": "unresolved", // (예비)창업자
  "0013007": "unresolved", // 단기근로자
  // 영농종사자: real text explicitly excludes registered business owners
  // ("사업자등록을 하고 사업체를 경영하는 자 제외") — not self_employed. UNRESOLVED.
  "0013008": "unresolved", // 영농종사자
  "0013009": "unresolved", // 기타
  "0013010": "unrestricted", // 제한없음
};

const SCHOOL_CD_STATUS: Record<string, YouthCodeImplementationStatus> = {
  "0049001": "unresolved", // 고졸 미만
  "0049002": "unresolved", // 고교 재학
  "0049003": "unresolved", // 고졸 예정
  // 고교 졸업: a university/graduate_school profile must NOT be assumed to
  // satisfy this (over-qualification exclusions are common in entry-level
  // programs targeting this code — see real example 20260522005400213218).
  "0049004": "unresolved", // 고교 졸업
  "0049005": "safe", // 대학 재학
  // 대졸 예정: Phase 4-A's audit proposal (university=>PASS) was WRONG —
  // Damoa's `university` means the whole currently-enrolled undergrad
  // population (freshman..graduation-expected), a strict SUPERSET of
  // "대졸 예정". university vs 대졸예정 must resolve UNKNOWN, not PASS.
  // Corrected and left unresolved in Phase 4-B (§8).
  "0049006": "unresolved", // 대졸 예정
  "0049007": "safe", // 대학 졸업
  // 석·박사: real catalog text usage is MIXED (currently-enrolled grad
  // students, already-graduated post-docs, and skill-level "석박사 인재"
  // framing all appear) — does not cleanly equate to Damoa's
  // "graduate_school" (currently enrolled). Left unresolved per explicit
  // Phase 4-B verification instruction (§8).
  "0049008": "unresolved", // 석·박사
  "0049009": "unresolved", // 기타
  "0049010": "unrestricted", // 제한없음
};

const SBIZ_CD_STATUS: Record<string, YouthCodeImplementationStatus> = {
  // Every specific code is UNRESOLVED/UNSUPPORTED per the Phase 4-A audit
  // (§9): 0014001(중소기업) is company-vs-employee ambiguous, 0014002(여성)/
  // 0014003(기초생활수급자)/0014005(장애인)/0014006(농업인)/0014007(군인)/
  // 0014008(지역인재) have no matching Damoa profile field, and 0014004
  // (한부모가정) is a SCOPE MISMATCH against `singleParentFamily` (that
  // field means family-membership, not "applicant is themself the single
  // parent") — do not reuse it. No new rules for any sbizCd code this
  // phase (§9 explicit instruction).
  "0014001": "unresolved", // 중소기업
  "0014002": "unresolved", // 여성
  "0014003": "unresolved", // 기초생활수급자
  "0014004": "unresolved", // 한부모가정
  "0014005": "unresolved", // 장애인
  "0014006": "unresolved", // 농업인
  "0014007": "unresolved", // 군인
  "0014008": "unresolved", // 지역인재
  "0014009": "unresolved", // 기타
  "0014010": "unrestricted", // 제한없음
};

const PLCY_MAJOR_CD_STATUS: Record<string, YouthCodeImplementationStatus> = {
  // No academic-major profile field exists in Damoa today (types/profile.ts
  // has no subject-matter field) — every specific code stays unresolved;
  // no new profile field/UI proposed this phase (§10).
  "0011001": "unresolved", // 인문계열
  "0011002": "unresolved", // 사회계열
  "0011003": "unresolved", // 상경계열
  "0011004": "unresolved", // 이학계열
  "0011005": "unresolved", // 공학계열
  "0011006": "unresolved", // 예체능계열
  "0011007": "unresolved", // 농산업계열
  "0011008": "unresolved", // 기타
  "0011009": "unrestricted", // 제한없음
};

const IMPLEMENTATION_STATUS_BY_FIELD: Record<string, Record<string, YouthCodeImplementationStatus>> = {
  mrgSttsCd: MRG_STTS_CD_STATUS,
  earnCndSeCd: EARN_CND_SE_CD_STATUS,
  jobCd: JOB_CD_STATUS,
  schoolCd: SCHOOL_CD_STATUS,
  sbizCd: SBIZ_CD_STATUS,
  plcyMajorCd: PLCY_MAJOR_CD_STATUS,
};

function buildFamily(apiField: string): YouthCodeFamily {
  const official = getOfficialYouthCodeFamily(apiField);
  if (!official) {
    throw new Error(`officialTable.ts has no family for eligibility-relevant field "${apiField}"`);
  }
  const statusByCode = IMPLEMENTATION_STATUS_BY_FIELD[apiField];
  const officialCodes = new Set(official.entries.map((e) => e.code));
  for (const code of Object.keys(statusByCode)) {
    if (!officialCodes.has(code)) {
      throw new Error(`table.ts has an implementationStatus decision for "${apiField}"/"${code}" but officialTable.ts has no such code`);
    }
  }
  return {
    apiField: official.apiField,
    familyId: official.familyId,
    entries: official.entries.map((e) => {
      const implementationStatus = statusByCode[e.code];
      if (!implementationStatus) {
        throw new Error(`table.ts has no implementationStatus decision for "${apiField}"/"${e.code}" (${e.label})`);
      }
      return { code: e.code, label: e.label, implementationStatus };
    }),
  };
}

export const YOUTH_CODEBOOK: YouthCodeFamily[] = Object.keys(IMPLEMENTATION_STATUS_BY_FIELD).map(buildFamily);

const codebookByField = new Map<string, YouthCodeFamily>(YOUTH_CODEBOOK.map((f) => [f.apiField, f]));

export function getYouthCodeFamily(apiField: string): YouthCodeFamily | undefined {
  return codebookByField.get(apiField);
}

export function getYouthCodeEntry(apiField: string, code: string) {
  return codebookByField.get(apiField)?.entries.find((e) => e.code === code);
}
