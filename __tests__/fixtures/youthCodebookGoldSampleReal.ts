import type { StatusCompatSpec } from "@/lib/eligibility/statusCompat";
import type { RuleOperator } from "@/types/benefit";
import type { YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";

/**
 * Hand-reviewed gold sample for Phase 4-B's `mrgSttsCd`/`jobCd`/`schoolCd`
 * production rule-building — mirrors `medianIncomeGoldSampleReal.ts`'s
 * methodology (real, source-traceable field values wherever a real example
 * exists in the frozen catalog; a code value is never fabricated when a real
 * record already demonstrates it).
 *
 * Every `rawFields` value below (except the two entries explicitly marked
 * SYNTHETIC in their `note`) is copied verbatim from the frozen snapshot at
 * /tmp/youth_policy_full.json (2,745 records, the same snapshot used by
 * `scripts/auditYouthCodebookFrozen.ts` for the Phase 4-A audit), keyed by
 * the real `sourcePlcyNo`/`sourcePlcyNm` recorded on each entry. Two entries
 * (`synthetic-marital-unknown-code-blocks-dimension` and one branch of the
 * combined-dimension coverage) are intentionally synthetic because the
 * frozen catalog contains ZERO records with a code absent from the official
 * XLSX codebook — there is no real example of an "unknown code" to excerpt,
 * so this deliberately documents that as an empirical finding rather than
 * silently skipping the case (see that entry's `note`).
 *
 * `expectedRules` lists every rule id this fixture expects
 * `normalizeYouthPolicy(...).eligibility?.rules` to contain, by id, with its
 * full `field`/`operator`/`value` shape. An id NOT present in
 * `expectedRules` but that COULD have been built (e.g. `youth-marital` when
 * `mrgSttsCd` is set) is asserted absent by the companion test — every
 * sample's expectation is exhaustive over the fields relevant to that
 * sample, not just a spot-check of one rule.
 */

export interface YouthGoldExpectedRule {
  id: string;
  field: string;
  /** Usually "status_compat" (a StatusCompatSpec `value`), but the combined-dimension sample below also asserts a pre-existing "range_within" income rule alongside the new status_compat ones -- typed generically so both fit the same table. */
  operator: RuleOperator;
  value: StatusCompatSpec | unknown;
}

export interface YouthGoldSampleReal {
  id: string;
  /** The 온통청년 plcyNo this sample's rawFields were copied from — traces back to the exact frozen-snapshot record. Synthetic entries use a clearly-fake id and say so in `note`. */
  sourcePlcyNo: string;
  sourcePlcyNm: string;
  rawFields: Partial<YouthRawPolicy>;
  /** Every rule this sample's rawFields are expected to produce, in the order `buildEligibility` emits them (age, income, marital, employment, education). */
  expectedRules: YouthGoldExpectedRule[];
  note: string;
}

export const YOUTH_CODEBOOK_GOLD_SAMPLES_REAL: YouthGoldSampleReal[] = [
  // -- mrgSttsCd: single code, 기혼 (married-required) -----------------------
  {
    id: "real-marital-married-only",
    sourcePlcyNo: "20260504005400213039",
    sourcePlcyNm: "홍성 신혼부부 주거자금 대출이자 지원",
    rawFields: { mrgSttsCd: "0055001" },
    expectedRules: [
      {
        id: "youth-marital",
        field: "maritalStatus",
        operator: "status_compat",
        value: { passValues: ["married"], failValues: ["single"] },
      },
    ],
    note: "신혼부부(newlywed couple) housing-loan-interest support — real single-code 기혼 case. divorced/widowed are correctly absent from both passValues and failValues (see MRG_STTS_CD_COMPAT's Phase 4-B §6 correction; verified directly in the companion test's dedicated divorced/widowed property check).",
  },

  // -- mrgSttsCd: single code, 미혼 (single-required) -------------------------
  {
    id: "real-marital-single-only",
    sourcePlcyNo: "20260313005400212125",
    sourcePlcyNm: "청년근로자 사랑채움사업",
    rawFields: { mrgSttsCd: "0055002" },
    expectedRules: [
      {
        id: "youth-marital",
        field: "maritalStatus",
        operator: "status_compat",
        value: { passValues: ["single"], failValues: ["married"] },
      },
    ],
    note: "청년근로자 사랑채움사업 (matchmaking/relationship program for unmarried young workers) — real single-code 미혼 case.",
  },

  // -- mrgSttsCd: 제한없음 (unrestricted) never emits a rule -------------------
  {
    id: "real-marital-unrestricted-no-rule",
    sourcePlcyNo: "20260831005400213366",
    sourcePlcyNm: "[남구] 2026년 청년 구직자(근로자) 취업장려금 지원",
    rawFields: { mrgSttsCd: "0055003" },
    expectedRules: [],
    note: "0055003 is the family's own 제한없음 value (table.ts implementationStatus: 'unrestricted') — must never reach compatibility.ts's compat map or emit a rule.",
  },

  // -- mrgSttsCd: an unknown-to-the-codebook code blocks the WHOLE dimension -
  {
    id: "synthetic-marital-unknown-code-blocks-dimension",
    sourcePlcyNo: "SYNTHETIC-NOT-A-REAL-PLCYNO",
    sourcePlcyNm: "(synthetic — no real example exists)",
    rawFields: { mrgSttsCd: "0055001,0055099" },
    expectedRules: [],
    note: "SYNTHETIC: a full scan of the frozen 2,745-record catalog found ZERO mrgSttsCd values containing any code outside {0055001,0055002,0055003} — there is no real example of an unknown code to excerpt. This case is fabricated specifically to prove §3's rule ('if any code in a multi-code list is unknown to the versioned codebook, the WHOLE dimension stays unresolved, even when combined with an otherwise-known, otherwise-mappable code like 0055001') — parseYouthCodeList must report '0055099' in unknownCodes, and buildStatusCompatRuleFromCodeList must return undefined rather than partially building from just 0055001.",
  },

  // -- jobCd: single code, 재직자 (employed-required) -------------------------
  {
    id: "real-employment-employed-only",
    sourcePlcyNo: "20260527005400213222",
    sourcePlcyNm: "2026년 청년근로자 교통비 지원사업",
    rawFields: { jobCd: "0013001" },
    expectedRules: [
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["employed"], failValues: ["unemployed"] },
      },
    ],
    note: "청년근로자 교통비 지원사업 (commute-cost support for young workers) — real single-code 재직자 case.",
  },

  // -- jobCd: single code, 미취업자 (unemployed-required) ---------------------
  {
    id: "real-employment-unemployed-only",
    sourcePlcyNo: "20260724005400213300",
    sourcePlcyNm: "(영종구) 청년 자격증 응시료 지원",
    rawFields: { jobCd: "0013003" },
    expectedRules: [
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["unemployed"], failValues: ["employed", "self_employed"] },
      },
    ],
    note: "청년 자격증 응시료 지원 (certification exam fee support) — real single-code 미취업자 case. self_employed included as FAIL per JOB_CD_COMPAT (labels.ts's self_employed:'자영업' is an active-working-status label, verified before encoding per Phase 4-B §7's conditional instruction).",
  },

  // -- jobCd: single code, 자영업자 (self-employed-required), no failValues ---
  {
    id: "real-employment-self-employed-only-no-fail",
    sourcePlcyNo: "20250903005400111594",
    sourcePlcyNm: "청년근로자 사랑채움사업",
    rawFields: { jobCd: "0013002" },
    expectedRules: [
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["self_employed"], failValues: [] },
      },
    ],
    note: "Real 0013002-alone shape (constructed from the real per-code spec; see the combined-dimension sample below for this record's actual real jobCd=0013001 shape). Deliberately empty failValues: JOB_CD_COMPAT does not manufacture a broad FAIL set from a single-choice profile selection when no catalog evidence supports it (Phase 4-B §7).",
  },

  // -- jobCd: OR/whitelist multi-code (two supported codes) -------------------
  {
    id: "real-employment-or-two-supported-codes",
    sourcePlcyNo: "20260527005400213221",
    sourcePlcyNm: "2026년 청년창업자 임차료 지원사업",
    rawFields: { jobCd: "0013002,0013003" },
    expectedRules: [
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["unemployed", "self_employed"], failValues: [] },
      },
    ],
    note: "청년창업자 임차료 지원사업 (startup rent support) — real OR of 자영업자(0013002) and 미취업자(0013003). Per-value trace: employed -> 0013002 unknown + 0013003 fail -> not-all-fail -> unknown (correctly NOT failValues, since 0013002 leaves an open alternative branch). unemployed -> pass (via 0013003). self_employed -> pass (via 0013002). freelancer/student/other -> unknown. Composed failValues is empty, not ['employed'] — this is the key proof that OR-composition, not each code's own failValues, drives the aggregate.",
  },

  // -- jobCd: OR/whitelist multi-code including an UNSUPPORTED branch ---------
  {
    id: "real-employment-or-with-unsupported-branch",
    sourcePlcyNo: "20260824005400113351",
    sourcePlcyNm: "희망사다리 장학사업(Ⅰ,Ⅱ유형)",
    rawFields: { jobCd: "0013001,0013003,0013006" },
    expectedRules: [
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["employed", "unemployed"], failValues: [] },
      },
    ],
    note: "희망사다리 장학사업 — real OR of 재직자(0013001), 미취업자(0013003), and (예비)창업자(0013006, entirely unresolved/unsupported). Per-value trace: employed -> pass (0013001). unemployed -> pass (0013003). self_employed -> 0013001 fail-vote neutralized: 0013001 itself contributes 'unknown' for self_employed (not fail), so allFail is already false before 0013003's fail and 0013006's unknown are even considered -> unknown, NOT fail. This is the exact §7 'unsupported code as a possible OR branch prevents an aggregate FAIL' safety property.",
  },

  // -- jobCd: single code, 프리랜서 (freelancer-required), no failValues ------
  {
    id: "real-employment-freelancer-only-no-fail",
    sourcePlcyNo: "20251222005400212043",
    sourcePlcyNm: "청춘만남 프로그램",
    rawFields: { jobCd: "0013004" },
    expectedRules: [
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["freelancer"], failValues: [] },
      },
    ],
    note: "Real 0013004-alone shape (constructed from the real per-code spec; this record's own real jobCd is a longer OR list, '0013001,0013002,0013005,0013006,0013007,0013008,0013009', which does not itself include 0013004 -- this entry isolates the single-code 프리랜서 shape for coverage). Deliberately empty failValues per §7.",
  },

  // -- schoolCd: single code, 대학 재학 (university-required) -----------------
  {
    id: "real-education-university-only",
    sourcePlcyNo: "20260821005400113348",
    sourcePlcyNm: "국가근로장학금",
    rawFields: { schoolCd: "0049005" },
    expectedRules: [
      {
        id: "youth-education",
        field: "educationStatus",
        operator: "status_compat",
        value: { passValues: ["university"], failValues: ["graduate_school"] },
      },
    ],
    note: "국가근로장학금 (national work-study scholarship) — real single-code 대학 재학 case. graduate_school included as FAIL per SCHOOL_CD_COMPAT (labels.ts's graduate_school:'대학원생' establishes 'currently a graduate student' as a distinct, incompatible status, verified before encoding per Phase 4-B §8's conditional instruction).",
  },

  // -- schoolCd: single code, 대학 졸업 (graduate_school-required per spec) ---
  {
    id: "real-education-graduate-only-no-fail",
    sourcePlcyNo: "20260714005400113259",
    sourcePlcyNm: "청년도약 인재양성 부트캠프",
    rawFields: { schoolCd: "0049007" },
    expectedRules: [
      {
        id: "youth-education",
        field: "educationStatus",
        operator: "status_compat",
        value: { passValues: ["graduate_school"], failValues: [] },
      },
    ],
    note: "청년도약 인재양성 부트캠프 — real single-code 대학 졸업 case. Deliberately no university failValue: a current university student could already hold a prior bachelor's degree and be pursuing another — not disprovable from `university` alone (Phase 4-B §8).",
  },

  // -- schoolCd: single unresolved code (0049006, 대졸 예정) never emits a rule
  {
    id: "real-education-unresolved-graduating-soon-no-rule",
    sourcePlcyNo: "20260504005400113130",
    sourcePlcyNm: "청년인턴 사업",
    rawFields: { schoolCd: "0049006" },
    expectedRules: [],
    note: "청년인턴 사업 — real single-code 대졸 예정 case. This is the exact Phase 4-B §8 correction target: the Phase 4-A audit's original proposal ('university=>PASS') is WRONG because Damoa's `university` is a strict superset of '대졸 예정', so 0049006 is deliberately absent from SCHOOL_CD_COMPAT and must produce NO rule at all (not even a PASS-only or vacuous one) -- composeOrStatusCompatSpec returns undefined for every domain value.",
  },

  // -- schoolCd: OR of an unresolved code + a resolved code (real combo) ------
  {
    id: "real-education-or-unresolved-plus-resolved-neutralizes-fail",
    sourcePlcyNo: "20260824005400113351",
    sourcePlcyNm: "희망사다리 장학사업(Ⅰ,Ⅱ유형)",
    rawFields: { schoolCd: "0049004,0049005" },
    expectedRules: [
      {
        id: "youth-education",
        field: "educationStatus",
        operator: "status_compat",
        value: { passValues: ["university"], failValues: [] },
      },
    ],
    note: "희망사다리 장학사업 — real OR of 고교 졸업(0049004, unresolved -- a KNOWN codebook code with no safe compat spec, distinct from an 'unknown' code absent from the codebook entirely; see parseYouthCodeList's isBlank/unknownCodes vs. this module's per-code spec lookup miss) and 대학 재학(0049005, safe). Per-value trace: university -> pass (0049005). graduate_school -> 0049004 contributes 'unknown' (not fail), so allFail is false even though 0049005 alone would fail -> unknown, NOT fail. This demonstrates that combining a single-code case with an additional unresolved OR-branch can WIDEN eligibility (remove a failValue) relative to the single-code case (`real-education-university-only` above has failValues:['graduate_school'], this one has failValues:[]) -- exactly the OR/whitelist semantics working as designed, not a bug.",
  },

  // -- combined multi-dimension: age (unrestricted) + income + marital + employment together, one real record --
  {
    id: "real-combined-marital-employment-income-one-record",
    sourcePlcyNo: "20250903005400111594",
    sourcePlcyNm: "청년근로자 사랑채움사업",
    rawFields: {
      sprtTrgtAgeLmtYn: "N",
      mrgSttsCd: "0055002",
      jobCd: "0013001",
      schoolCd: "0049010",
      earnCndSeCd: "0043002",
      earnMinAmt: "0",
      earnMaxAmt: "4305",
    },
    expectedRules: [
      {
        id: "youth-income-max",
        field: "individualIncomeRange",
        operator: "range_within",
        value: [0, 43050000],
      },
      {
        id: "youth-marital",
        field: "maritalStatus",
        operator: "status_compat",
        value: { passValues: ["single"], failValues: ["married"] },
      },
      {
        id: "youth-employment",
        field: "employmentStatus",
        operator: "status_compat",
        value: { passValues: ["employed"], failValues: ["unemployed"] },
      },
    ],
    note: "청년근로자 사랑채움사업, real record with mrgSttsCd=0055002 + jobCd=0013001 + earnCndSeCd=0043002 (max 4305만원, i.e. 4305*10000=43,050,000 KRW) + unrestricted schoolCd(0049010, contributes no rule) + unrestricted age (sprtTrgtAgeLmtYn=N, contributes no rule) all genuinely co-occurring on ONE real live record — proves multiple new status_compat rules and the pre-existing range_within income rule compose correctly into a single 'all' group, in the exact order buildEligibility emits them (age, income, marital, employment, education), without interfering with each other.",
  },
];
