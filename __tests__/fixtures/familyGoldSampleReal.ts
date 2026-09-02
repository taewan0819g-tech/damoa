/**
 * Hand-reviewed, stratified gold sample built from REAL public MOIS (정부24 /
 * Gov24, api.odcloud.kr/api/gov24/v3) 지원대상 / 선정기준 marital/family
 * eligibility text — mirrors `regionGoldSampleReal.ts`'s methodology. Every
 * `text` here is a VERBATIM excerpt (whitespace-collapsed only) copied from
 * the frozen snapshot captured at /tmp/mois_serviceList_full.json
 * (10,967 rows) and audited via scripts/auditFamilyEligibilityFrozen.ts —
 * see that script's bucket output for the full population each excerpt was
 * drawn from.
 *
 * Per the Phase 2 (marital/family) spec: do NOT fabricate "real" gold
 * examples. Where the audit found NO clean real-MOIS example of a category
 * (e.g. a bare, unambiguous "maritalStatus: single/married" applicant
 * statement — audit found bare 미혼/기혼 dominated by false positives, see
 * `gihon-branching-not-gate` / `compound-single-parent-mihon` below), the
 * required category is instead represented by the real excerpt that PROVES
 * why no rule is safely extractable — an honest negative finding, not an
 * invented positive one.
 *
 * Every entry's `expectation` was decided by manual review of the ACTUAL
 * text against the Phase 2 spec's conservatism rules (see `note`), then
 * cross-checked by running it through the real `extractEligibilityFromText`
 * (see familyGoldSampleReal.test.ts) — any future change to the family
 * parsers that flips one of these is a real regression signal.
 */

export type FamilyGoldField = "singleParent" | "multiculturalFamily" | "marriageDurationYears" | "childrenCount";

export interface FamilyGoldExpectedRule {
  field: FamilyGoldField;
  operator: string;
  value: unknown;
}

export interface FamilyGoldExpectation {
  /** Family-dimension fields expected to produce exactly this rule. */
  expectedFamilyRules: FamilyGoldExpectedRule[];
  /** Whether at least one unresolved clause is expected in the result. */
  expectUnresolved: boolean;
  /** When true, the WHOLE text must resolve to zero rules of any kind (e.g. the sibling-category-OR bailout). */
  expectNoRulesAtAll?: boolean;
}

export interface FamilyGoldSampleReal {
  id: string;
  /** The MOIS 서비스ID this excerpt was copied from — traces back to the exact frozen-snapshot record. */
  sourceServiceId: string;
  sourceField: "target" | "criteria";
  text: string;
  expectation: FamilyGoldExpectation;
  note: string;
}

export const FAMILY_GOLD_SAMPLES_REAL: FamilyGoldSampleReal[] = [
  // -- children numeric threshold (rule) -----------------------------------
  {
    id: "real-rule-children-threshold-2",
    sourceServiceId: "131200000008",
    sourceField: "target",
    text: "○ 만18세 미만의 자녀 2명 이상을 양육하는 자(가족관계등록부 기준, 양자 및 배우자 자녀 포함)",
    expectation: {
      expectedFamilyRules: [{ field: "childrenCount", operator: "gte", value: 2 }],
      expectUnresolved: false,
    },
    note: "다자녀가정 양육수당류: clean 자녀 N명 이상 pattern. Also contains '배우자' descriptively (enumerating what counts as a child) — correctly produces NO rule for that token since 배우자 has no implemented extractor (see real-no-rule-spouse-descriptive).",
  },
  {
    id: "real-rule-children-threshold-3-multi-threshold",
    sourceServiceId: "378000000167",
    sourceField: "target",
    text: "*지원대상: 성남시 다자녀가구(자녀 3명 이상)의 셋째 이상 미혼 대학생 - 첫째, 둘째는 지원 제외",
    expectation: {
      expectedFamilyRules: [{ field: "childrenCount", operator: "gte", value: 3 }],
      expectUnresolved: false,
    },
    note: "성남시 다자녀가구 대학생 지원: a DIFFERENT real threshold (3, not 2) than the other children-count sample — confirms the extractor reads the number from the text instead of hardcoding one. '미혼' here describes the STUDENT (a dependent), not the applicant's own marital status, so correctly produces no maritalStatus rule (unimplemented this phase).",
  },

  // -- false positive: family keyword present, no real eligibility gate ----
  {
    id: "real-no-rule-spouse-descriptive",
    sourceServiceId: "128000000001",
    sourceField: "target",
    text: "○ 타인의 범죄행위로 피해를 당한 사람과 그 배우자, 직계친족, 형제자매 등",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "범죄피해자 지원: '배우자' merely enumerates who ELSE may apply on behalf of a victim — not an 'applicant must have a spouse' requirement. Confirms the audit's false-positive finding for the 배우자 bucket (399 matches / 385 records, overwhelmingly descriptive); 배우자 has no implemented extractor by design.",
  },

  // -- no-family-restriction wording ("관계없이") ----------------------------
  {
    id: "real-no-rule-marriage-date-irrelevant",
    sourceServiceId: "519000000153",
    sourceField: "target",
    text: "자금 대출이자 지원실행 ※ 2024년에 본 지원을 받은 자는 혼인신고 일자와 관계없이 지원 가능(기본2년+ 추가2년) - 청도군 소재 주택 주거자금(매입, 전세)",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "청도군 주거자금 대출이자: explicitly states the marriage-registration date does NOT gate eligibility ('관계없이'). Must produce NO marriageDurationYears rule AND no unresolved-clause noise — the source is affirmatively saying there's nothing to resolve, not leaving an ambiguous clause.",
  },

  // -- single parent (rule) -------------------------------------------------
  {
    id: "real-rule-single-parent-clean",
    sourceServiceId: "307000000102",
    sourceField: "target",
    text: "○ 관내 5세이하의 자녀를 둔 미혼한부모 및 그자녀",
    expectation: {
      expectedFamilyRules: [{ field: "singleParent", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "미혼한부모 냉방비 지원류: clean, direct applicant qualifier with no neighboring sibling-status-category list. '미혼한부모' contains 한부모 as a substring, matched by design (미혼모/미혼부/한부모가 모두 legally recognized 한부모 categories per 한부모가족지원법).",
  },
  {
    id: "real-rule-single-parent-compound-mihon",
    sourceServiceId: "138300000052",
    sourceField: "target",
    text: "대한민국 국적의 24세 이하 미혼 한부모 및 임산부 - (1순위) 19세 이하 청소년 미혼 한부모",
    expectation: {
      expectedFamilyRules: [{ field: "singleParent", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY: 'single' (maritalStatus). Real MOIS phrasing never presents a clean, isolated 미혼자 applicant statement (audit: 84 matches / 83 records, dominated by the compound term 미혼모/부/한부모 or a dependent's status) — this text is the representative real example: '미혼' here is part of '미혼 한부모', which correctly produces a singleParent rule, but intentionally produces NO maritalStatus:single rule (not implemented this phase; would require disentangling '미혼' from '한부모' with no real high-confidence pattern to do so safely).",
  },

  // -- multicultural family (rule) -------------------------------------------
  {
    id: "real-rule-multicultural-family",
    sourceServiceId: "138300000058",
    sourceField: "target",
    text: "○ 다문화가족 미취학 아동 또는 초등학교 재학 중인 아동 *세부 지원 대상: 다문화",
    expectation: {
      expectedFamilyRules: [{ field: "multiculturalFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "다문화가족 자녀 교육지원: '또는' here joins two age/school-stage alternatives for the CHILD, both still under the same 다문화가족 qualifier — only 1 family-dimension field is extracted from this text, so the cross-dimension OR safety net correctly does not fire (needs 2+ distinct extracted fields).",
  },

  // -- marriage-duration condition (rule) ------------------------------------
  {
    id: "real-rule-marriage-duration-1-year",
    sourceServiceId: "373000000116",
    sourceField: "target",
    text: "○ 아래의 조건을 모두 총족한 신혼부부 - 신청일 기준 혼인신고일이 1년 이내인 신혼부부 - 신청일 기준 부부 모두 울주군에 6개월 이상 거주 중",
    expectation: {
      expectedFamilyRules: [{ field: "marriageDurationYears", operator: "lte", value: 1 }],
      expectUnresolved: false,
    },
    note: "울주군 신혼부부 지원: real, explicit 1-year threshold — extracted via the reference-date-aware marriageDurationYears derived field (see domain/profile/marriageDuration.ts), not a hardcoded newlywed boolean.",
  },
  {
    id: "real-unresolved-newlywed-no-threshold",
    sourceServiceId: "406000000122",
    sourceField: "target",
    text: "○ 파주시 주소지를 둔 예비신혼부부",
    expectation: {
      expectedFamilyRules: [],
      expectUnresolved: true,
    },
    note: "REQUIRED CATEGORY: ambiguous newlywed. 예비신혼부부 mentioned with NO duration threshold anywhere in this text — per the spec, must NOT guess a fixed 5/7-year definition; reported as unresolved instead. The region rule (파주시) still resolves independently and correctly.",
  },

  // -- boolean OR / categorical-alternative safety (family) ------------------
  {
    id: "real-unresolved-sibling-status-category-or",
    sourceServiceId: "129000000032",
    sourceField: "target",
    text: "○ 「국민기초생활 보장법」에 따른 수급자 또는 차상위계층, 「한부모 가족지원법」에 따른 지원대상자, 「장애인연금법」에 따른 수급자, 2명",
    expectation: {
      expectedFamilyRules: [],
      expectUnresolved: true,
      expectNoRulesAtAll: true,
    },
    note: "REQUIRED CATEGORY: Boolean OR case (family). 한부모 here is only ONE of several unrelated qualifying status categories (수급자/차상위계층/한부모/장애인연금 수급자) joined by 또는/쉼표 — extracting singleParent:true as a hard AND-required rule would be WRONG (would incorrectly require single-parent status for someone who qualifies as, say, a 장애인연금 recipient instead). The categorical-alternative guard (hasNearbySiblingStatusCategory) catches this even though our other extractors don't produce a second rule from '수급자/차상위계층' (they're legal-citation category labels, not the numeric income text our income parser looks for), so the ordinary cross-dimension OR safety net alone couldn't have caught it.",
  },

  // -- multi-condition family case -------------------------------------------
  {
    id: "real-rule-multi-condition-marriage-region-housing",
    sourceServiceId: "393000000111",
    sourceField: "target",
    text: "○ 공고일 기준, 부부 모두 안산시에 주민등록을 두고 거주하고 있는 혼인기간 5년이내 무주택 신혼부부",
    expectation: {
      expectedFamilyRules: [{ field: "marriageDurationYears", operator: "lte", value: 5 }],
      expectUnresolved: false,
    },
    note: "안산시 신혼부부 전세자금: THREE simultaneous real conditions (residence in 안산시, 무주택, 혼인기간 5년 이내) with no 또는/혹은 anywhere — all extracted and ANDed together correctly (this is genuinely an AND situation, not an OR one). Test only asserts the family-dimension rule; residence/homeowner rules are covered by their own gold sets.",
  },

  // -- 기혼: income-calculation branching, not an eligibility gate -----------
  {
    id: "real-no-rule-gihon-income-branching",
    sourceServiceId: "484000000144",
    sourceField: "target",
    text: "① 신청일 기준 19세~45세로 광양시 거주(예정) 무주택자 → 기혼자의 경우 부부 모두 19세~45세여야 함",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "REQUIRED CATEGORY: 'married' (maritalStatus). '기혼자'/'미혼' in real MOIS text is almost always a branch in HOW another rule (age range, income aggregation) applies, not a standalone 'must be married' gate (audit: 13 matches / 12 records, mostly income-basis branching) — this real excerpt shows 기혼자 modifying the age rule's SCOPE ('부부 모두') rather than gating eligibility on its own, so correctly produces no maritalStatus rule (not implemented this phase; the real signal doesn't support a safe direct mapping).",
  },

  // -- documented limitation: proximity-based '관계없이' scoping -------------
  {
    id: "real-limitation-irrelevance-scope-too-broad",
    sourceServiceId: "WII000000820",
    sourceField: "criteria",
    text: "득 인정이 기준 중위소득의 100% 이하 ※ 24세 이하의 청소년한부모는 소득 수준 관계없이 출산지원시설에 입소 가능",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "위기임신 출산지원시설: KNOWN LIMITATION. '관계없이' here governs '소득 수준' (income level), not 청소년한부모 status — 한부모 status is actually the REAL qualifying category here (a true positive we miss). The proximity-only irrelevance guard (statesFieldIrrelevant) can't distinguish 'X 관계없이' from 'Y (near X) 관계없이', so it conservatively suppresses the singleParent rule entirely (false negative) rather than risk the reverse (extracting a rule that isn't there). Under-extraction is the safe failure direction per the Phase 2 conservatism mandate — documented here rather than silently accepted.",
  },

  // -- exclusion/negation: real text that could FALSELY trigger the guard ---
  {
    id: "real-rule-single-parent-exclusion-guard-not-triggered",
    sourceServiceId: "O00033500001",
    sourceField: "target",
    text: "가구(자녀 3명 이상 세대 중 18세 이하 자녀 1명 이상), 장애 정도가 심한 장애인(중증), 한부모가족 ○ 제외대상(중복수혜 불가) - 장애인은 타 감면과 중복 수혜 불가",
    expectation: {
      expectedFamilyRules: [
        { field: "childrenCount", operator: "gte", value: 3 },
        { field: "singleParent", operator: "eq", value: true },
      ],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY: exclusion/negation safety. 한부모가족 is listed as ONE of the eligible categories; '제외대상' a few characters later starts a DIFFERENT bulleted clause about a duplicate-benefit restriction for 장애인, not an exclusion of 한부모가족 itself. The exclusion-window scoping (isExcludedAfter) stops at the '○' bullet break, so this correctly still produces singleParent:true instead of being wrongly flipped to excluded — a real regression guard for the negation heuristic.",
  },
];
