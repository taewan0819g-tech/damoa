import type { MedianIncomeBoundary } from "@/domain/medianIncome/evaluate";

/**
 * Hand-reviewed, stratified gold sample built from REAL public MOIS (정부24 /
 * Gov24, api.odcloud.kr/api/gov24/v3) 지원대상 / 선정기준 "기준중위소득" (median
 * income) eligibility text — mirrors `familyGoldSampleReal.ts`'s methodology.
 * Every `text` here is a VERBATIM excerpt (whitespace-collapsed only, exactly
 * like the family gold sample) copied from the frozen snapshot captured at
 * /tmp/mois_serviceList_full.json (10,967 rows), the SAME snapshot used by
 * `scripts/auditMedianIncomeEligibilityFrozen.ts` and by the manual
 * fixed-reference review at `docs/median-income-fixed-reference-review.md`.
 *
 * Every entry's `expectation` was decided by (1) manually reading the real
 * excerpt against `koreanEligibilityParser.ts`'s actual, current regex logic,
 * then (2) cross-checked by running it through the REAL
 * `extractEligibilityFromText` (see medianIncomeGoldSampleReal.test.ts) — any
 * future change to the median-income parser that flips one of these is a
 * real regression signal, not a fixture bug.
 *
 * Per the project's safety philosophy (false negatives OK, false positives
 * are NOT): several entries below intentionally document a REAL parser
 * limitation via `note` rather than pretending the limitation doesn't exist
 * or silently working around it in the fixture. Do not "fix" a sample's
 * `expectation` to hide a limitation — if the parser's real behavior changes,
 * update the `note` honestly along with the expectation.
 *
 * While BUILDING this fixture, running real candidates through the actual
 * extractor surfaced one genuine, previously-undetected parser bug (see
 * `real-rule-bare-median-income-no-gijun-prefix` below): `MEDIAN_INCOME_RE`
 * required the literal "기준" prefix, so 203 of 881 real frozen-snapshot
 * "중위소득" mentions that drop that prefix (very common real MOIS phrasing)
 * were completely invisible to the parser -- not even reported as
 * unresolved, silently vanishing instead. That bug was fixed directly in
 * `koreanEligibilityParser.ts` (MEDIAN_INCOME_RE and MEDIAN_INCOME_PERCENT_RE
 * now both treat "기준" as optional) as part of building this gold set; this
 * fixture keeps a dedicated regression sample for it.
 */

export interface MedianIncomeGoldExpectedValue {
  percent: number;
  boundary: MedianIncomeBoundary;
  incomeMetric: "household_income";
  householdSizeMode: "scales_with_profile_household";
  year?: number;
}

export interface MedianIncomeGoldExpectation {
  /** At most one median-income rule is ever expected -- the production parser only ever resolves the FIRST 기준중위소득/중위소득 percent+boundary occurrence in a text. */
  expectedRule?: MedianIncomeGoldExpectedValue;
  /** Whether at least one unresolved clause is expected in the result. */
  expectUnresolved: boolean;
}

export interface MedianIncomeGoldSampleReal {
  id: string;
  /** The MOIS 서비스ID this excerpt was copied from — traces back to the exact frozen-snapshot record. */
  sourceServiceId: string;
  sourceField: "target" | "criteria";
  text: string;
  expectation: MedianIncomeGoldExpectation;
  note: string;
}

export const MEDIAN_INCOME_GOLD_SAMPLES_REAL: MedianIncomeGoldSampleReal[] = [
  // -- ordinary profile-scaled household-income threshold (rule) ------------
  {
    id: "real-rule-ordinary-profile-household-income",
    sourceServiceId: "135200000103",
    sourceField: "target",
    text: "○ 기준중위소득 125% 이하인 등록장애인(외국인 포함)\n\n○ 자동차사고로 인하여 중증후유장애를 입은 사람(수급자, 차상위계층)",
    expectation: {
      expectedRule: {
        percent: 125,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "장애인법률구조지원: clean, ordinary 기준중위소득 N% 이하 clause with no household-size mention nearby and no explicit year -- the baseline positive case. Confirms `scales_with_profile_household` (never a fixed size) is emitted, per the checkpoint-4 parser fix.",
  },

  // -- bare '중위소득' with no '기준' prefix (real coverage-gap fix) ----------
  {
    id: "real-rule-bare-median-income-no-gijun-prefix",
    sourceServiceId: "383000000146",
    sourceField: "target",
    text: "○ 안양시 돌봄 취약가구\n - (공통사항) 중위소득 120% 미만 사회적 배려계층 우선지원\n - 저소득층, 중증장애인, 한부모가정, 다문화가정, 1인가구",
    expectation: {
      expectedRule: {
        percent: 120,
        boundary: "lt",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "안양시 돌봄 취약가구: real example of the very common bare '중위소득' (no '기준' prefix) phrasing -- BEFORE the fix made while building this gold set, this whole clause was silently invisible to the parser (no rule, no unresolved entry either). Also proves the trailing '1인가구' (listed as one of several alternative target sub-groups, not a table row tied to this specific clause) sits safely OUTSIDE the ±40/+20 extraction window, so it correctly does NOT suppress extraction the way a truly nearby household-size number would.",
  },

  // -- all four boundary words -------------------------------------------
  {
    id: "real-rule-boundary-word-gt",
    sourceServiceId: "333000000377",
    sourceField: "target",
    text: "○ (신청일 기준) 부산시 거주중인 기준중위소득 150% 초과 산모",
    expectation: {
      expectedRule: {
        percent: 150,
        boundary: "gt",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "해운대구 산모·신생아 건강관리 지원(확대): real 초과 (gt) example -- an income-EXCLUSION program (helps people ABOVE the median-income cutoff who don't qualify for the standard lower-income version).",
  },
  {
    id: "real-rule-boundary-word-gte",
    sourceServiceId: "460000000134",
    sourceField: "target",
    text: "신청일 기준 충남도 내 거주자, 소득초과(기준중위소득 180% 이상)로 정부지원에서 제외된 법률혼, 사실혼 난임부부",
    expectation: {
      expectedRule: {
        percent: 180,
        boundary: "gte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "충남 난임부부 지원: real 이상 (gte) example, another income-EXCLUSION-style clause (충남도 자체지원은 정부지원에서 소득초과로 제외된 부부를 대상으로 함). Also co-extracts a region rule (충청남도) from the same text -- confirms median-income extraction doesn't block/get blocked by an unrelated region rule.",
  },
  // 이하 (lte) is exercised by nearly every other sample below.
  // 미만 (lt) is exercised by real-rule-bare-median-income-no-gijun-prefix above.

  // -- explicit year --------------------------------------------------------
  {
    id: "real-rule-explicit-year",
    sourceServiceId: "515000000168",
    sourceField: "target",
    text: "관내 중소·중견기업에 주30시간 이상 근무하고, 3개월 이상 근무중인 만 19세~39세 미혼 청년\n임금이 2026년 기준 중위소득 150% 이하인 자",
    expectation: {
      expectedRule: {
        percent: 150,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
        year: 2026,
      },
      expectUnresolved: false,
    },
    note: "청년근로자 사랑채움 사업: real explicit-year example ('2026년 기준 중위소득'), also co-extracts an age range rule from the same text.",
  },
  {
    id: "real-rule-no-explicit-year",
    sourceServiceId: "138300000040",
    sourceField: "target",
    text: "기준중위소득 125%이하의 한부모가족 또는 미혼부",
    expectation: {
      expectedRule: {
        percent: 125,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "한부모무료법률구조: real no-explicit-year example -- `year` is correctly omitted (not defaulted to the current year) from the emitted spec. Also demonstrates OR-structure category wording ('한부모가족 또는 미혼부') NOT blocking median-income extraction: the OR here joins two overlapping single-parent-family sub-categories (미혼부 is itself legally a 한부모), not two unrelated eligibility dimensions, so the cross-dimension-OR safety net correctly does not suppress either the median-income rule or the singleParentFamily rule.",
  },

  // -- explicit per-household-size table marker -> unresolved ---------------
  {
    id: "real-unresolved-table-marker",
    sourceServiceId: "641000000164",
    sourceField: "target",
    text: "○ 위기상황이 발생한 1년 이내의 가정으로 소득, 재산, 금융재산 기준을 충족하는 경우\n○ 소득기준 : 기준 중위소득100% 이하(4인가구 기준 650만 원) ※ 가구원 수에 따라 기준금액 상이",
    expectation: { expectUnresolved: true },
    note: "경기도형긴급복지지원: REQUIRED CATEGORY -- ambiguous/multi-size table text. The record states the cutoff varies by household size ('가구원 수에 따라 기준금액 상이') right after citing ONE size's absolute amount as an example (4인가구 기준 650만 원) -- exactly the checkpoint-4 finding that a single nearby household-size number is not a safe fixed-reference signal. `MEDIAN_INCOME_TABLE_MARKER_RE` unconditionally forces unresolved here.",
  },
  {
    id: "real-unresolved-table-truncated-by-window",
    sourceServiceId: "644000000244",
    sourceField: "target",
    text: "❍ 소득기준: 당해연도 보건복지부에서 고시하는 기준중위소득 120%이하\n   <2024년 기준 준중위소득120%>\n   - 1인가구 : 2,674,134원, 2인가구 : 4,419,131원, 3인가구 : 5,657,588원\n     4인가구 : 6,875,896원, 5인가구 : 8,034,882원, 6인가구 : 9,142,043원",
    expectation: {
      expectedRule: {
        percent: 120,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
        year: 2024,
      },
      expectUnresolved: false,
    },
    note: "충청남도 입원 생활비 지원: the full per-household-size table (1인~6인가구) sits just OUTSIDE the ±40/+20 extraction window, so it doesn't trigger the household-size guard. This happens to still be the CORRECT extraction (a full per-size table genuinely IS `scales_with_profile_household`, the same shape this parser always emits) -- documented here as a real example of the window's limits, not a case that needs fixing: an explicit per-size table can never safely become `fixed_reference_household` even if the window HAD reached it (see checkpoint-4 review), so there is no unsafe outcome regardless of window placement here.",
  },

  // -- genuinely fixed-reference household size (per manual review) still --
  // -- conservatively left unresolved by the production parser -------------
  {
    id: "real-unresolved-genuine-fixed-reference-loan-program",
    sourceServiceId: "149200000009",
    sourceField: "criteria",
    text: "월평균 소득이 3인 가구 기준 중위소득 2분의 1 이하인 노동자",
    expectation: { expectUnresolved: true },
    note: "근로복지공단 생활안정자금 융자: per `docs/median-income-fixed-reference-review.md` (#2, class A), this is one of only 7/15 real fixed-reference hits CONFIRMED genuinely fixed via external corroboration (a documented national loan-program standard, independent of the applicant's real household size) -- yet the production parser still safely resolves it to unresolved, for TWO independent reasons: (1) `fixed_reference_household` is never auto-inferred from text at all anymore (checkpoint-4 fix), and (2) this excerpt uses Korean fraction notation ('2분의 1') instead of a literal '%' digit, which `MEDIAN_INCOME_PERCENT_RE` deliberately does not support (see that regex's doc comment). Proves the conservative fallback holds even for a real A-classified case, and even independently of the household-size guard.",
  },
  {
    id: "real-unresolved-fixed-target-population-bare-median-income",
    sourceServiceId: "314000000271",
    sourceField: "target",
    text: "지원대상: 사회적 고립가구 중 결식우려 1인가구 (기초생활수급자·차상위계층 또는 중위소득100% 이하)",
    expectation: { expectUnresolved: true },
    note: "양천 반올림 밑반찬 지원 사업: per the checkpoint-4 review (#3, class A) -- target population is explicitly '1인가구' so a fixed 1-person reference would actually be correct BY CONSTRUCTION here, but the parser still conservatively falls back to unresolved because it cannot distinguish this from the 8/15 real cases where a nearby household-size number was NOT a safe signal (see review doc). Also exercises the bare '중위소득100%' (no 기준 prefix, no space before the digits) wording variant together with the household-size guard in the same real excerpt.",
  },

  // -- ambiguous: no percent digit at all near a household-size mention ----
  {
    id: "real-unresolved-no-percent-digit",
    sourceServiceId: "149200000018",
    sourceField: "target",
    text: "○ 월평균소득이 보건복지부 장관이 고시하는 3인 가구 기준 중위소득 이하인 자로 다음에 해당하는 자",
    expectation: { expectUnresolved: true },
    note: "산재근로자 생활안정자금 융자: real example with a boundary word ('이하') but NO percent digit anywhere nearby (the clause means 'at or below the (100%) 3-person median income figure', a bare comparison with an implicit 100%) -- `MEDIAN_INCOME_PERCENT_RE` requires an explicit digit run before '%', so this correctly falls back to unresolved rather than guessing percent=100.",
  },

  // -- metric disqualifiers (real examples) ----------------------------------
  {
    id: "real-unresolved-sodeukinjeongaek-disqualifier",
    sourceServiceId: "304000000106",
    sourceField: "target",
    text: "법정한부모가족(소득인정액 기준중위소득 63% 이하)",
    expectation: { expectUnresolved: true },
    note: "REQUIRED CATEGORY: 소득인정액 (recognized income, not raw household income). Real, compact example -- also co-extracts a singleParentFamily rule from the same text (a different field), confirming the median-income disqualifier doesn't block unrelated family-dimension extraction.",
  },
  {
    id: "real-unresolved-health-insurance-premium-disqualifier",
    sourceServiceId: "433000000142",
    sourceField: "target",
    text: "○ 인제군에 주민등록주소를 둔 출산산모\n - 기본지원대상: 의료급여수급자(생계, 의료, 주거, 교육급여수급자) 또는 차상위계층, 건강보험료기준 중위소득 150%이하에 해당하는 출산가정\n- 예외지원대상: 건강보험료기준 중위소득150%이상 초과 출산가정",
    expectation: { expectUnresolved: true },
    note: "REQUIRED CATEGORY: 건강보험료 (health-insurance premium band, not raw household income). Real example -- '건강보험료기준' sits immediately before '중위소득', well within the disqualifier window. Also co-extracts a region rule (인제군) from the same text.",
  },
  {
    id: "real-unresolved-jonghapsodeuk-and-fraction-disqualifier",
    sourceServiceId: "999000000027",
    sourceField: "target",
    text: "농어민으로서 종사하는 분야 외의 분야에서 직전 연도에 발생한 종합소득금액이 직전 연도 기준 중위소득의 100분의 40 이상인 사람",
    expectation: { expectUnresolved: true },
    note: "농어가목돈마련 저축장려금: doubly-disqualifying real example -- 종합소득금액 (an individual taxpayer's aggregated tax-return income, not household income) AND Korean fraction notation ('100분의 40', not a literal '%' digit) both independently rule this out. Exercises both the metric-disqualifier regex and the deliberate fraction-notation non-support decision on the same real excerpt.",
  },

  // -- individual/applicant income (본인 label), not household income -------
  {
    id: "real-unresolved-individual-label-bonin",
    sourceServiceId: "627000000136",
    sourceField: "target",
    text: "- (본인) 기준중위소득 120% 이하 - (가구) 기준중위소득 140% 이하",
    expectation: { expectUnresolved: true },
    note: "청년희망적금: REQUIRED CATEGORY -- individual (not household) income false positive. '(본인)' directly labels the FIRST 기준중위소득 mention as an individual-income comparison; the record separately states a DIFFERENT '(가구)'-labeled household clause a few characters later, proving 본인/가구 are deliberately distinguished categories in this real record. Both the individual-scoped first clause and the reachable second clause fall back to unresolved together (see the corresponding synthetic unit test in koreanEligibilityParser.test.ts for why: this parser resolves only the FIRST percent+boundary match in the whole text).",
  },
  {
    id: "real-unresolved-combined-self-spouse-with-nearby-size-footnote",
    sourceServiceId: "519000000153",
    sourceField: "target",
    text: "본인·배우자 합산 연소득이 기준 중위소득 180%* 이하\n     * 2025년 기준 : 월6,840,000원(2인가구) / 연82,080,000원(2인가구)",
    expectation: { expectUnresolved: true },
    note: "청도군 신혼부부 주거자금 대출이자 지원: '본인·배우자 합산' (combined self+spouse) is legitimately a household-income-shaped comparison, NOT an individual-income false positive (see the synthetic 'still extracts...' unit test for the same wording WITHOUT this footnote, which DOES extract). In the real FULL record, though, the '(2인가구)' footnote citing the absolute KRW figure sits inside the ±40/+20 window, so the household-size guard conservatively still routes this to unresolved -- an honest example of the guard being stricter on real (noisier) text than on a clean synthetic example.",
  },

  // -- category/status wording that must not block extraction ---------------
  {
    id: "real-rule-status-category-wording-not-blocking",
    sourceServiceId: "135200000102",
    sourceField: "criteria",
    text: "○ 한센병사업대상자 중 수급자에서 제외된 자로서 중위소득 60% 이하인 자에게 지원",
    expectation: {
      expectedRule: {
        percent: 60,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "재가한센인생계비지원: category/status wording ('수급자에서 제외된 자') sits right next to the bare 중위소득 anchor but does not disqualify it -- '수급자' is a legal category label, not one of the metric-disqualifier tokens (소득인정액/건강보험료/개인소득/종합소득).",
  },

  // -- descriptive mention: no percent/boundary at all -> unresolved --------
  {
    id: "real-unresolved-descriptive-mention-no-boundary",
    sourceServiceId: "542000000110",
    sourceField: "target",
    text: "○ 건강보험가입자(국.도비사업과 동일 =기준중위소득 확인)",
    expectation: { expectUnresolved: true },
    note: "REQUIRED CATEGORY: purely descriptive/no-signal mention. '기준중위소득 확인' ('median income [is] checked/verified') references the concept with no percent digit and no boundary word anywhere nearby -- correctly falls back to unresolved rather than fabricating a threshold.",
  },

  // -- AND structure --------------------------------------------------------
  {
    id: "real-rule-and-structure-cross-dimension",
    sourceServiceId: "443000000661",
    sourceField: "target",
    text: "○ 기준중위소득 180% 이하 청년\n   - 지원기준: 신청일 기준 옥천군에 주민등록을 두고 실제 거주하고 있는 청년\n     · 나이기준: 19세 이상 ~39세 이하 청년\n     · 소득기준: 기준중위소득 180% 이하\n                        * 소득이 없는 경우 부모님 기준중위소득으로 판단",
    expectation: {
      expectedRule: {
        percent: 180,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "REQUIRED CATEGORY: AND structure, across dimensions (median income AND age AND region, no 또는/혹은 anywhere) -- all three co-extracted correctly without the cross-dimension-OR safety net wrongly firing (that net only triggers on an actual OR occurrence linking distinct dimensions). A second, later 기준중위소득 mention ('소득이 없는 경우 부모님 기준중위소득으로 판단') is a fallback-basis clause for income-less applicants; only the FIRST occurrence is captured, per this parser's single-match design.",
  },
  {
    id: "real-limitation-and-structure-within-median-income-only-first-captured",
    sourceServiceId: "161300000099",
    sourceField: "criteria",
    text: "ㅇ (소득) 청년 원가구*의 소득이 기준 중위소득 100% 이하이면서 청년 독립가구 소득이 기준 중위소득 60% 이하",
    expectation: {
      expectedRule: {
        percent: 100,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "청년월세 지원: KNOWN LIMITATION. This is a genuine AND ('이면서') of TWO separate median-income thresholds on two DIFFERENT income bases (원가구 100% 이하 AND 독립가구 60% 이하) -- the parser only ever resolves the FIRST percent+boundary occurrence in a text, so the second threshold (독립가구 60% 이하) is silently NOT captured as a second rule, and is also NOT reported as unresolved (this whole clause resolves cleanly with just the first threshold). This under-extraction is the safe failure direction (a real applicant is evaluated against a real, correctly-extracted 100%-of-원가구 rule, just not the ADDITIONAL 60%-of-독립가구 one), but it means this specific record's eligibility rules are incomplete. Documented honestly here per the project's 'do not encode a known limitation as correct' mandate rather than silently accepted.",
  },

  // -- multiple median-income percentages in one source ----------------------
  {
    id: "real-rule-multiple-percentages-first-occurrence-wins",
    sourceServiceId: "179038700004",
    sourceField: "target",
    text: "국민기초생활보장법상 기초생활보장수급자 및 차상위계층(기준중위소득 50% 이하) - 기초생활보장수급자 * 생계급여(기준중위소득 30% 이하), 의료급여(기준중위소득 40% 이하), 주거급여(기준중위소득 43% 이하), 교육급여(기준중위소득 50% 이하) - 차상위계층: 기준중위소득 50% 이하",
    expectation: {
      expectedRule: {
        percent: 50,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "HPV 국가예방접종사업: REQUIRED CATEGORY -- multiple median-income percentages in one source (50/30/40/43/50%, one per welfare-benefit type: 차상위계층/생계급여/의료급여/주거급여/교육급여). The parser deterministically resolves only the FIRST occurrence in raw text order (차상위계층 기준, 50%) -- the more specific per-benefit-type breakdown (생계급여 30%, 의료급여 40%, 주거급여 43%) is silently not captured as separate rules. Documented as a real limitation, not fixed here: safely disambiguating which of several benefit-type-scoped percentages applies to THIS specific service record would require program-specific knowledge this generic text parser doesn't have.",
  },

  // -- percent expressed as the WORD '퍼센트', not the '%' symbol ------------
  {
    id: "real-unresolved-percent-word-not-symbol",
    sourceServiceId: "644000000230",
    sourceField: "target",
    text: "월 소득액이 국민기초생활보장법 제2조제11호에 따른 기준중위소득 100퍼센트 이하인 가구(세대)",
    expectation: { expectUnresolved: true },
    note: "민주화운동 관련자 예우 및 지원: real example using the WORD '퍼센트' instead of the '%' symbol -- `MEDIAN_INCOME_PERCENT_RE` only matches a literal '%' sign, so this correctly falls back to unresolved (a deliberate scope limit, not a bug: supporting the word form would require a much broader, riskier number-word grammar).",
  },
];
