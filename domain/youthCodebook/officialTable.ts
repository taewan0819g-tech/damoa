/**
 * Phase 4-B pre-merge cleanup, §5: the ONE authoritative transcription of
 * every code->label row in the official 온통청년(Youth Center) Open API
 * 코드정의서 ("API코드정보.xlsx", `코드정보` sheet — see `provenance.ts` for
 * SHA-256/verification details).
 *
 * All 11 families / 69 data rows live here, verbatim, with NO
 * `implementationStatus` judgment attached — this file is pure data
 * (code -> Korean label), nothing else. Two downstream consumers build on
 * top of it without re-transcribing any label:
 *  - `table.ts` promotes the 6 eligibility-relevant families
 *    (mrgSttsCd/earnCndSeCd/jobCd/schoolCd/sbizCd/plcyMajorCd), attaching a
 *    per-code `implementationStatus` decision on top of the labels here.
 *  - `scripts/auditYouthCodebookFrozen.ts` imports this directly for its
 *    full-11-family real-catalog cross-check (it previously carried its own
 *    second manually-copied transcription of the same rows — removed during
 *    the Phase 4-B pre-merge cleanup to eliminate drift risk).
 *
 * Do NOT add a second manually-copied transcription of these rows anywhere
 * else in the codebase — import from here instead.
 */

export interface OfficialYouthCodeEntry {
  code: string;
  /** Official Korean label, transcribed verbatim from the XLSX. */
  label: string;
}

export interface OfficialYouthCodeFamily {
  /** The raw 온통청년 API field name this family applies to (e.g. "mrgSttsCd"). */
  apiField: string;
  /** The XLSX family/group code (e.g. "0055"). */
  familyId: string;
  entries: OfficialYouthCodeEntry[];
}

export const OFFICIAL_YOUTH_CODEBOOK: OfficialYouthCodeFamily[] = [
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

const officialByField = new Map<string, OfficialYouthCodeFamily>(
  OFFICIAL_YOUTH_CODEBOOK.map((f) => [f.apiField, f])
);

export function getOfficialYouthCodeFamily(apiField: string): OfficialYouthCodeFamily | undefined {
  return officialByField.get(apiField);
}
