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
 * `real-no-rule-gihon-income-branching` below), the required category is
 * instead represented by the real excerpt that PROVES why no rule is safely
 * extractable — an honest negative finding, not an invented positive one.
 *
 * Checkpoint-2 revision (per external review): the field/value shapes below
 * were updated to match three semantic fixes made to the production parser:
 *   1. Marriage-duration is now the exact-calendar-date `marriageDate` /
 *      `marriage_duration_within` rule (see domain/profile/marriageDuration.ts),
 *      never a floored `marriageDurationYears` integer.
 *   2. `singleParent` was renamed `singleParentFamily` — real MOIS text
 *      qualifies BOTH the parent and their child under the same 한부모(가족)
 *      clause, so the field means family MEMBERSHIP, not "is themselves the
 *      parent" (see types/profile.ts's field doc).
 *   3. A clearly-CURRENT "신혼부부 ... N년 이내" clause now additionally
 *      asserts `maritalStatus == "married"` (compound AND rule) — a
 *      divorced/widowed applicant with a recent historical marriage date must
 *      not pass a current-신혼부부 gate on marriageDate alone.
 * This also adds 7 new real-excerpt samples covering the task-6 regression
 * category list that the pre-checkpoint-2 fixture didn't yet represent
 * (한부모가족 자녀, 미혼모, 미혼부, ordinary-language "한 부모" false positives,
 * bare 다자녀, bare 신혼부부).
 *
 * Every entry's `expectation` was decided by manual review of the ACTUAL
 * text against the Phase 2 spec's conservatism rules (see `note`), then
 * cross-checked by running it through the real `extractEligibilityFromText`
 * (see familyGoldSampleReal.test.ts) — any future change to the family
 * parsers that flips one of these is a real regression signal.
 */

export type FamilyGoldField =
  | "singleParentFamily"
  | "multiculturalFamily"
  | "childrenCount"
  | "marriageDate"
  | "maritalStatus";

export interface FamilyGoldExpectedRule {
  field: FamilyGoldField;
  operator: string;
  value: unknown;
}

export interface FamilyGoldExpectation {
  /**
   * Family-dimension rules expected to be present, as an EXACT set (no
   * extra/unexpected family rule may appear either) — see
   * familyGoldSampleReal.test.ts's exact-set comparison.
   */
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
    note: "다자녀가정 양육수당류: clean 자녀 N명 이상 pattern (task-6 category: '자녀 2명 이상'). Also contains '배우자' descriptively (enumerating what counts as a child) — correctly produces NO rule for that token since 배우자 has no implemented extractor (see real-no-rule-spouse-descriptive).",
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
    note: "성남시 다자녀가구 대학생 지원: a DIFFERENT real threshold (3, not 2) than the other children-count sample — confirms the extractor reads the number from the text instead of hardcoding one. '미혼' here describes the STUDENT (a dependent), not the applicant's own marital status, so correctly produces no maritalStatus rule (unimplemented as a standalone bare-미혼 gate this phase).",
  },
  {
    id: "real-unresolved-bare-multichild",
    sourceServiceId: "304000000146",
    sourceField: "target",
    text: "어려운 경제상황과 전ㆍ월세값 상승으로 생활에 어려움을 겪고 있는 저소득 주민 - 기초생활수급자/ 의료급여 대상자/ 65세 이상 홀몸어르신/ 저소득 국가유공자/ 저소득 장애인/ 저소득 북한이탈주민 등 - 관내 대학교 재학생 - 1인가구 - 다자녀가구",
    expectation: { expectedFamilyRules: [], expectUnresolved: true },
    note: "REQUIRED CATEGORY (task-6): bare '다자녀' with NO accompanying number anywhere in the text — one of several alternative qualifying household categories (기초생활수급자/1인가구/다자녀가구 등). Per the Phase 2 spec, guessing a fixed 2-or-3 threshold for bare 다자녀 is exactly the imagined-not-measured failure this project must avoid, so it's surfaced as unresolved instead of silently dropped or guessed.",
  },

  // -- false positive: family keyword present, no real eligibility gate ----
  {
    id: "real-no-rule-spouse-descriptive",
    sourceServiceId: "128000000001",
    sourceField: "target",
    text: "○ 타인의 범죄행위로 피해를 당한 사람과 그 배우자, 직계친족, 형제자매 등",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "범죄피해자 지원: '배우자' merely enumerates who ELSE may apply on behalf of a victim — not an 'applicant must have a spouse' requirement. Confirms the audit's false-positive finding for the 배우자 bucket (706 matches / 385 records, overwhelmingly descriptive); 배우자 has no implemented extractor by design.",
  },

  // -- no-family-restriction wording ("관계없이") ----------------------------
  {
    id: "real-no-rule-marriage-date-irrelevant",
    sourceServiceId: "519000000153",
    sourceField: "target",
    text: "자금 대출이자 지원실행 ※ 2024년에 본 지원을 받은 자는 혼인신고 일자와 관계없이 지원 가능(기본2년+ 추가2년) - 청도군 소재 주택 주거자금(매입, 전세)",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "청도군 주거자금 대출이자: explicitly states the marriage-registration date does NOT gate eligibility ('관계없이'). The nearby '2024년'/'2년' numbers sit far outside the marriage-duration regex's short lazy-fill window, so no marriageDate rule (or false unresolved noise) is produced — the source is affirmatively saying there's nothing to resolve, not leaving an ambiguous clause.",
  },

  // -- single parent: applicant + child membership (rule) -------------------
  {
    id: "real-rule-single-parent-clean",
    sourceServiceId: "307000000102",
    sourceField: "target",
    text: "○ 관내 5세이하의 자녀를 둔 미혼한부모 및 그자녀",
    expectation: {
      expectedFamilyRules: [{ field: "singleParentFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY (task-6): '한부모 및 그 자녀'. 미혼한부모 냉방비 지원류: clean, direct qualifier covering BOTH the parent and their child under one 한부모 clause — exactly why the field is named/scoped `singleParentFamily` (family MEMBERSHIP), not 'is themselves a parent'. '미혼한부모' contains 한부모 as a substring, matched by design (미혼모/미혼부/한부모가 모두 legally recognized 한부모 categories per 한부모가족지원법).",
  },
  {
    id: "real-rule-single-parent-child-of-family",
    sourceServiceId: "407000000111",
    sourceField: "target",
    text: "○ 기준중위소득 65%이하 한부모가족 자녀",
    expectation: {
      expectedFamilyRules: [{ field: "singleParentFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY (task-6): '한부모가족의 자녀'. A CHILD-scoped qualifier ('한부모가족 자녀', not the parent themselves) — the cleanest real proof that `singleParentFamily` must mean family membership, not applicant-is-parent, otherwise this genuinely-eligible child applicant would incorrectly read false.",
  },
  {
    id: "real-rule-single-parent-mihonmo",
    sourceServiceId: "319000000111",
    sourceField: "target",
    text: "○ 만 5세 이하 아동을 양육하는 미혼모(부)자 - 동작구에 6개월 이상 주민등록을 한 실거주자",
    expectation: {
      expectedFamilyRules: [{ field: "singleParentFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY (task-6): '미혼모'. Solo 미혼모(부)자 phrasing with no accompanying '한부모' token — exercises the standalone MIHONMO_BU_RE branch of the parser rather than the fused-한부모 branch. The '6개월 이상 주민등록' clause is a RESIDENCE duration, not a marriage duration, so correctly produces no marriage-duration rule/unresolved (no 혼인/결혼 root nearby).",
  },
  {
    id: "real-rule-single-parent-mihonbu",
    sourceServiceId: "138300000040",
    sourceField: "target",
    text: "기준중위소득 125%이하의 한부모가족 또는 미혼부",
    expectation: {
      expectedFamilyRules: [{ field: "singleParentFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY (task-6): '미혼부'. '한부모가족 또는 미혼부' lists two overlapping single-parent-family alternatives (미혼부 IS a 한부모 sub-category, not an unrelated sibling status), so the hasNearbySiblingStatusCategory OR-list guard correctly does NOT fire here (미혼부/미혼모 are intentionally excluded from SIBLING_STATUS_CATEGORY_RE) — still resolves to a single singleParentFamily:true rule rather than being wrongly suppressed as an ambiguous cross-category OR.",
  },
  {
    id: "real-rule-single-parent-compound-mihon",
    sourceServiceId: "138300000052",
    sourceField: "target",
    text: "대한민국 국적의 24세 이하 미혼 한부모 및 임산부 - (1순위) 19세 이하 청소년 미혼 한부모",
    expectation: {
      expectedFamilyRules: [{ field: "singleParentFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "Real MOIS phrasing never presents a clean, isolated 미혼자 applicant statement (audit: 126 matches / 83 records, dominated by the compound term 미혼모/부/한부모 or a dependent's status) — this text is the representative real example: '미혼' here is part of '미혼 한부모' (space-separated, but at a genuine Hangul word boundary after '이하'), which correctly produces a singleParentFamily rule, but intentionally produces NO maritalStatus:single rule (not implemented this phase; would require disentangling '미혼' from '한부모' with no real high-confidence pattern to do so safely).",
  },

  // -- ordinary-language "한 부모" false positives (NOT the legal category) --
  {
    id: "real-no-rule-single-parent-verb-collision",
    sourceServiceId: "308000000119",
    sourceField: "target",
    text: "○ 지원대상: 입양신고일 3개월 전부터 서울특별시 강북구에 주민등록을 두고 입양축하금 신청일까지 실제 거주하고 있는 입양아동의 부 또는 모 (단, 국가와 지방자치단체에 등록된 입양기관에서 아동을 입양한 부모로 함)",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "REQUIRED CATEGORY (task-6): ordinary-language '한 부모' that is NOT the legal category. '아동을 입양한 부모' ('parents WHO ADOPTED a child') is the '-한' verb-ending immediately followed by '부모', not the legal 한부모 term — '한' is preceded by the Hangul character '양' (입양한), so the word-boundary guard (isGenuineSingleParentMatch / isHangulBoundaryOk) correctly rejects it. Also exercises the '3개월' near '입양신고일' (not 혼인/결혼) NOT triggering the marriage-duration-months unresolved path.",
  },
  {
    id: "real-no-rule-single-parent-idiom-one-or-more",
    sourceServiceId: "540000000110",
    sourceField: "target",
    text: "○ 함안군 소재 고등학교에 진학하는 신입생으로서 신청일 현재 한 부모 이상과 학생이 함안군에 주소를 두고 신청기준의 자격을 갖춘 자",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "REQUIRED CATEGORY (task-6): second real shape of the ordinary-language '한 부모' false positive — '한 부모 이상' is the numeral idiom 'one parent OR MORE' (an ordinary headcount, not the legal 한부모 status label; the legal term never takes a following bare '이상'). Filtered by the no-family-suffix + following-이상 guard. Also proves the two guards are independent: this text passes the Hangul-boundary check (preceded by whitespace, a genuine word start) but is still correctly rejected by the second (이상-idiom) guard.",
  },

  // -- multicultural family: child/member wording (rule) ---------------------
  {
    id: "real-rule-multicultural-family",
    sourceServiceId: "138300000058",
    sourceField: "target",
    text: "○ 다문화가족 미취학 아동 또는 초등학교 재학 중인 아동 *세부 지원 대상: 다문화",
    expectation: {
      expectedFamilyRules: [{ field: "multiculturalFamily", operator: "eq", value: true }],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY (task-6): 다문화가족 child/member wording. 다문화가족 자녀 교육지원: '또는' here joins two age/school-stage alternatives for the CHILD, both still under the same 다문화가족 qualifier — only 1 family-dimension field is extracted from this text, so the cross-dimension OR safety net correctly does not fire (needs 2+ distinct extracted fields).",
  },

  // -- marriage-duration condition (rule) ------------------------------------
  {
    id: "real-rule-marriage-duration-1-year",
    sourceServiceId: "373000000116",
    sourceField: "target",
    text: "○ 아래의 조건을 모두 총족한 신혼부부 - 신청일 기준 혼인신고일이 1년 이내인 신혼부부 - 신청일 기준 부부 모두 울주군에 6개월 이상 거주 중",
    expectation: {
      expectedFamilyRules: [
        { field: "maritalStatus", operator: "eq", value: "married" },
        { field: "marriageDate", operator: "marriage_duration_within", value: { years: 1, boundary: "lte" } },
      ],
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY (task-6): 신혼부부 + explicit duration. 울주군 신혼부부 지원: real, explicit 1-year threshold, resolved via the exact-calendar-date `marriageDate`/`marriage_duration_within` rule (see domain/profile/marriageDuration.ts), never a floored marriageDurationYears integer. Because this is a clearly-CURRENT 신혼부부 mention (not 예비신혼부부), the compound rule ALSO asserts maritalStatus==married — a divorced/widowed applicant whose marriageDate alone falls in the window must not pass. '6개월 이상 거주' is a RESIDENCE duration counted from an unrelated point, correctly not read as a second marriage-duration clause.",
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
    note: "REQUIRED CATEGORY (task-6): 예비신혼부부. 예비신혼부부 mentioned with NO duration threshold anywhere in this text — per the spec, must NOT guess a fixed 5/7-year definition, AND must NOT assert maritalStatus==married (예비 means not yet married); reported as unresolved instead. The region rule (파주시) still resolves independently and correctly (covered by its own gold set).",
  },
  {
    id: "real-unresolved-newlywed-bare-current",
    sourceServiceId: "383000000143",
    sourceField: "target",
    text: "주민등록상 안양시 거주 신혼부부, 예비부부",
    expectation: {
      expectedFamilyRules: [],
      expectUnresolved: true,
    },
    note: "REQUIRED CATEGORY (task-6): bare 신혼부부 without definition. A clearly-CURRENT (not 예비신혼부부) '신혼부부' mention with NO duration threshold anywhere in the text — correctly produces neither a marriageDate rule (no threshold to extract) nor a standalone maritalStatus==married rule (that compound assertion is intentionally only ever emitted TOGETHER with a resolved duration clause, per Step 3 of the Phase 2 fix — never on its own from a bare mention). Reported as unresolved instead of guessed. '예비부부' (not '예비신혼부부') is a distinct real MOIS phrasing that also doesn't match NEWLYWED_BARE_RE/NEWLYWED_CURRENT_RE, so it contributes no separate signal here.",
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
    note: "REQUIRED CATEGORY (task-6): single-parent category inside an OR list. 한부모 here is only ONE of several unrelated qualifying status categories (수급자/차상위계층/한부모/장애인연금 수급자) joined by 또는/쉼표 — extracting singleParentFamily:true as a hard AND-required rule would be WRONG (would incorrectly require single-parent status for someone who qualifies as, say, a 장애인연금 recipient instead). The categorical-alternative guard (hasNearbySiblingStatusCategory) catches this even though our other extractors don't produce a second rule from '수급자/차상위계층' (they're legal-citation category labels, not the numeric income text our income parser looks for) — the bare trailing '2명' also correctly produces no childrenCount rule (no preceding '자녀' token).",
  },

  // -- multi-condition family case -------------------------------------------
  {
    id: "real-rule-multi-condition-marriage-region-housing",
    sourceServiceId: "393000000111",
    sourceField: "target",
    text: "○ 공고일 기준, 부부 모두 안산시에 주민등록을 두고 거주하고 있는 혼인기간 5년이내 무주택 신혼부부",
    expectation: {
      expectedFamilyRules: [
        { field: "maritalStatus", operator: "eq", value: "married" },
        { field: "marriageDate", operator: "marriage_duration_within", value: { years: 5, boundary: "lte" } },
      ],
      expectUnresolved: false,
    },
    note: "안산시 신혼부부 전세자금: THREE simultaneous real conditions (residence in 안산시, 무주택, 혼인기간 5년 이내) with no 또는/혹은 anywhere — all extracted and ANDed together correctly (this is genuinely an AND situation, not an OR one). The current-신혼부부 compound rule fires here too (same reasoning as real-rule-marriage-duration-1-year). Test only asserts the family-dimension rules; residence/homeowner rules are covered by their own gold sets.",
  },

  // -- 기혼: income-calculation branching, not an eligibility gate -----------
  {
    id: "real-no-rule-gihon-income-branching",
    sourceServiceId: "484000000144",
    sourceField: "target",
    text: "① 신청일 기준 19세~45세로 광양시 거주(예정) 무주택자 → 기혼자의 경우 부부 모두 19세~45세여야 함",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "'기혼자'/'미혼' in real MOIS text is almost always a branch in HOW another rule (age range, income aggregation) applies, not a standalone 'must be married' gate (audit: 14 matches / 12 records, mostly income-basis branching) — this real excerpt shows 기혼자 modifying the age rule's SCOPE ('부부 모두') rather than gating eligibility on its own, so correctly produces no maritalStatus rule (not implemented as a standalone bare-기혼 gate this phase; the real signal doesn't support a safe direct mapping).",
  },

  // -- documented limitation: proximity-based '관계없이' scoping -------------
  {
    id: "real-limitation-irrelevance-scope-too-broad",
    sourceServiceId: "WII000000820",
    sourceField: "criteria",
    text: "득 인정이 기준 중위소득의 100% 이하 ※ 24세 이하의 청소년한부모는 소득 수준 관계없이 출산지원시설에 입소 가능",
    expectation: { expectedFamilyRules: [], expectUnresolved: false },
    note: "위기임신 출산지원시설: KNOWN LIMITATION. '관계없이' here governs '소득 수준' (income level), not 청소년한부모 status — 한부모 status is actually the REAL qualifying category here (a true positive we miss). The proximity-only irrelevance guard (statesFieldIrrelevant) can't distinguish 'X 관계없이' from 'Y (near X) 관계없이', so it conservatively suppresses the singleParentFamily rule entirely (false negative) rather than risk the reverse (extracting a rule that isn't there). Under-extraction is the safe failure direction per the Phase 2 conservatism mandate — documented here rather than silently accepted.",
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
        { field: "singleParentFamily", operator: "eq", value: true },
      ],
      expectUnresolved: false,
    },
    note: "Exclusion/negation safety. 한부모가족 is listed as ONE of the eligible categories; '제외대상' a few characters later starts a DIFFERENT bulleted clause about a duplicate-benefit restriction for 장애인, not an exclusion of 한부모가족 itself. The exclusion-window scoping (isExcludedAfter) stops at the '○' bullet break, so this correctly still produces singleParentFamily:true instead of being wrongly flipped to excluded — a real regression guard for the negation heuristic.",
  },
];
