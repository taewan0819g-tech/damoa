import type { MedianIncomeBoundary } from "@/domain/medianIncome/evaluate";

/**
 * Hand-reviewed, stratified gold sample built from REAL public MOIS (정부24 /
 * Gov24, api.odcloud.kr/api/gov24/v3) 지원대상 / 선정기준 "기준중위소득" (median
 * income) eligibility text — mirrors `familyGoldSampleReal.ts`'s methodology.
 * Every `text` here is a VERBATIM excerpt (whitespace-collapsed only, exactly
 * like the family gold sample) copied from the frozen snapshot captured at
 * /tmp/mois_serviceList_full.json (10,967 rows), the SAME snapshot used by
 * `scripts/auditMedianIncomeEligibilityFrozen.ts`.
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
 * ---------------------------------------------------------------------------
 * CHECKPOINT-5 REBUILD (external-review correction): an independent review
 * of the checkpoint-4 gold set found its "safe household-income" methodology
 * was itself circular/backwards — several samples below were originally
 * accepted as `median_income_threshold` rules merely because NO disqualifier
 * matched, not because a positive household-income label was actually
 * present. `koreanEligibilityParser.ts` now requires an explicit positive
 * signal (`MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE`) before ever emitting
 * a rule, and adds two disqualifier categories that were previously missing
 * entirely: WAGE/EARNED income (임금/근로소득 — the applicant's own individual
 * earnings) and COUPLE-COMBINED income (부부합산소득/본인·배우자 합산 — not
 * necessarily identical to full household income). This whole fixture was
 * re-derived against that stricter parser: every sample below was re-run
 * through the real, current extractor, and MANY changed outcome or source
 * example as a direct result (see individual notes). Most notably,
 * `real-rule-explicit-year` (old sourceServiceId 515000000168, "임금이 2026년
 * 기준 중위소득 150% 이하인 자") was WRONG under checkpoint-4 — it is a
 * WAGE-income clause, not household income, and is corrected here to
 * `real-unresolved-wage-income-disqualifier` with `expectUnresolved: true`.
 * ---------------------------------------------------------------------------
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
    sourceServiceId: "135200005013",
    sourceField: "target",
    text: "ㅇ 연령, 개인소득, 가구소득 3가지 모두 충족한 자\n   (가입연령) 신청 당시 만15~39세 이하\n   (소득기준) 월 10만원 이상 근로, 사업 소득 발생 \n   (가구소득) 기준 중위소득 50% 이하",
    expectation: {
      expectedRule: {
        percent: 50,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "자산형성지원사업(청년내일저축계좌): CHECKPOINT-5 REPLACEMENT for the old sample (서비스ID 135200000103, '기준중위소득 125% 이하인 등록장애인...') which had NO positive household-income label nearby and now correctly falls back to unresolved. This record's explicit '(가구소득)' label right before the anchor satisfies `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE`. Also proves an earlier, unrelated '개인소득' mention (a different eligibility dimension listed a few dozen characters before the anchor) does NOT block extraction -- it sits outside the ±40/+20 window.",
  },

  // -- bare '중위소득' with no '기준' prefix (real coverage-gap fix) ----------
  {
    id: "real-rule-bare-median-income-no-gijun-prefix",
    sourceServiceId: "149200005007",
    sourceField: "target",
    text: "∙ II유형: 15세~69세 구직자 중 I유형에 해당하지 않는 가구단위 중위소득 100% 이하(청년은 소득 무관)",
    expectation: {
      expectedRule: {
        percent: 100,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "국민취업지원제도: CHECKPOINT-5 REPLACEMENT (the old sample, 서비스ID 383000000146 '중위소득 120% 미만 사회적 배려계층 우선지원', had no positive household-income label and is now unresolved). This excerpt is the trailing 'II유형' clause of the real record (the full record's FIRST 중위소득 mention, '중위소득 60% 이하', has no positive signal nearby and would itself resolve to unresolved under the parser's single-first-match design -- excerpted here to isolate the still-real, still-verbatim positive-signal clause). Demonstrates both the bare '중위소득' (no '기준' prefix) coverage-gap fix AND the explicit household-unit framing '가구단위 중위소득' branch of the positive-signal regex.",
  },

  // -- boundary word: 미만 (lt), with a real positive household-income label -
  {
    id: "real-rule-boundary-word-lt",
    sourceServiceId: "429000000646",
    sourceField: "criteria",
    text: "○ 지원대상 : 건강보험가입자 중 지원 사업 대상 질환 1,413개, 소득 및 재산기준을 만족하는 사람\n\n - 환자가구 소득기준(기준 중위소득 140% 미만)",
    expectation: {
      expectedRule: {
        percent: 140,
        boundary: "lt",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "희귀질환자 의료비 지원사업: real 미만 (lt) example with a positive household label ('환자가구 소득기준'). Deliberately excerpted BEFORE the full per-household-size table that follows in the real record (1인~7인가구 absolute KRW amounts) -- this is the SAME record cited by `parseMedianIncomeClause`'s household-size-guard doc comment as a case whose full table sits just past this function's narrow context window. Proves the window-edge truncation genuinely does still produce the correct, safe `scales_with_profile_household` shape when a positive signal is present within the window, independent of what's truncated past it.",
  },

  // -- boundary word: 초과 (gt), with a real positive household-income label -
  {
    id: "real-rule-boundary-word-gt",
    sourceServiceId: "648000001103",
    sourceField: "target",
    text: "▪(거주지) 주민등록상 공고일 현재 경남 거주자\n▪(나이) 공고일 기준 18세 이상 ~ 39세 이하 ※ 군복무, 대체근무(산업기능요원 등) 복무에 따른 기간 포함\n▪(가구소득) 가구 기준중위소득 50% 초과 ~130% 이하\n▪(재직기준) 직장 소재지가 경남도이며, 공고일 기준 3개월 이상 사업장에 계속 근로중인 청년(정규직, 비정규직, 사업자)",
    expectation: {
      expectedRule: {
        percent: 50,
        boundary: "gt",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "(경남) 모다드림 청년통장 지원: CHECKPOINT-5 REPLACEMENT (the old sample, 서비스ID 333000000377, had no positive household-income label and is now unresolved). This record's explicit '(가구소득)' label directly precedes the anchor. The clause describes a BAND ('50% 초과 ~130% 이하') -- only the FIRST boundary+percent pair (50% 초과) is captured, per this parser's single-match design; the upper bound (130% 이하) is silently not captured as a second rule.",
  },

  // -- boundary word: 이상 (gte) -- empirical zero-corpus-hit finding --------
  {
    id: "real-unresolved-boundary-word-gte-no-corpus-example",
    sourceServiceId: "460000000134",
    sourceField: "target",
    text: "신청일 기준 충남도 내 거주자, 소득초과(기준중위소득 180% 이상)로 정부지원에서 제외된 법률혼, 사실혼 난임부부",
    expectation: { expectUnresolved: true },
    note: "충남 난임부부 지원: CHECKPOINT-5 CORRECTION -- under checkpoint-4 this was wrongly accepted as a household-income RULE purely because no disqualifier matched; there is in fact no positive household-income label anywhere nearby ('충남도 내 거주자'/'정부지원에서 제외된' describe eligibility/exclusion status, not income scope), so it now correctly falls back to unresolved. Kept here (rather than dropped) as a deliberate, honest EMPIRICAL FINDING: a full-corpus scan of the frozen snapshot (`scripts/auditMedianIncomeEligibilityFrozen.ts`) found ZERO real records anywhere with an '이상' (gte) boundary word AND a positive household-income label within the extraction window -- 이상-boundary median-income clauses in this real dataset are exclusively income-EXCLUSION clauses ('소득초과로 제외된') with no household-scoping wording. The 이상/gte code path itself remains directly exercised by the synthetic `it.each` boundary-word test in koreanEligibilityParser.test.ts (with a synthetic positive-signal prefix), since no real corpus example currently exists to do so.",
  },

  // -- explicit year --------------------------------------------------------
  {
    id: "real-rule-explicit-year",
    sourceServiceId: "B55029700002",
    sourceField: "target",
    text: "○ 의료적 요건 : 협약기관에서 1차 진료 후 담당의사가 상급종합병원에서의 진료가 필요하다고 판단한 자\n\n○ 사회경제적 요건 : 국내거주 중인 외국인 중, 2026년 기준 중위소득 90% 이하에 해당하는 자(동일 가구원 소득 합산하여 산정)\n\n★ 협약기관에서 의뢰가능한 대상자여야함",
    expectation: {
      expectedRule: {
        percent: 90,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
        year: 2026,
      },
      expectUnresolved: false,
    },
    note: "취약계층 외국인 의료비 지원: CHECKPOINT-5 REPLACEMENT. The PREVIOUS sample at this id (서비스ID 515000000168, '임금이 2026년 기준 중위소득 150% 이하인 자') is the exact bug the external review flagged: '임금' (wage/earned income) is the applicant's own individual earnings, NOT household income, and checkpoint-4 wrongly classified it as safe household income solely because no disqualifier matched. It is corrected below at `real-unresolved-wage-income-disqualifier`. This replacement genuinely has BOTH an explicit year ('2026년') AND a positive household label ('동일 가구원 소득 합산하여 산정') within the extraction window.",
  },
  {
    id: "real-rule-no-explicit-year",
    sourceServiceId: "461000000115",
    sourceField: "target",
    text: "○ 만18세 이상 근로능력자, 가구소득 기준중위소득 70%이하 이면서 재산이 4억원 이하인 자",
    expectation: {
      expectedRule: {
        percent: 70,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "예산형 공공근로사업(공공근로): CHECKPOINT-5 REPLACEMENT (the old sample, 서비스ID 138300000040 '기준중위소득 125%이하의 한부모가족 또는 미혼부', uses '가족' not '가구' so no longer matches the positive-signal regex and is now unresolved). This record's explicit '가구소득' label directly precedes the anchor; `year` is correctly omitted (not defaulted to the current year) from the emitted spec.",
  },

  // -- explicit per-household-size table marker -> unresolved ---------------
  {
    id: "real-unresolved-table-marker",
    sourceServiceId: "641000000164",
    sourceField: "target",
    text: "○ 위기상황이 발생한 1년 이내의 가정으로 소득, 재산, 금융재산 기준을 충족하는 경우\n○ 소득기준 : 기준 중위소득100% 이하(4인가구 기준 650만 원) ※ 가구원 수에 따라 기준금액 상이",
    expectation: { expectUnresolved: true },
    note: "경기도형긴급복지지원: REQUIRED CATEGORY -- ambiguous/multi-size table text. The record states the cutoff varies by household size ('가구원 수에 따라 기준금액 상이') right after citing ONE size's absolute amount as an example (4인가구 기준 650만 원) -- exactly the checkpoint-4 finding that a single nearby household-size number is not a safe fixed-reference signal. `MEDIAN_INCOME_TABLE_MARKER_RE` unconditionally forces unresolved here, independent of the checkpoint-5 positive-signal requirement (this text also happens to have no positive household label nearby either).",
  },
  {
    id: "real-unresolved-table-truncated-by-window",
    sourceServiceId: "644000000244",
    sourceField: "target",
    text: "❍ 소득기준: 당해연도 보건복지부에서 고시하는 기준중위소득 120%이하\n   <2024년 기준 준중위소득120%>\n   - 1인가구 : 2,674,134원, 2인가구 : 4,419,131원, 3인가구 : 5,657,588원\n     4인가구 : 6,875,896원, 5인가구 : 8,034,882원, 6인가구 : 9,142,043원",
    expectation: { expectUnresolved: true },
    note: "충청남도 입원 생활비 지원: CHECKPOINT-5 CORRECTION -- previously accepted as a RULE (120% lte, year 2024) under checkpoint-4 purely because no disqualifier matched. Re-verified directly (even with the trailing per-size table entirely removed, isolating just the first line) that this excerpt has NO positive household-income label anywhere nearby -- '당해연도 보건복지부에서 고시하는' describes the SOURCE of the figure (a government notice), not that it is household-scoped. Kept as a distinct, honestly-relabeled category: a real record whose outcome flips from checkpoint-4's blacklist-only 'safe' classification to checkpoint-5's positive-evidence-required 'unresolved' classification, independent of the household-size table.",
  },

  // -- genuinely fixed-reference household size (per manual review) still --
  // -- conservatively left unresolved by the production parser -------------
  {
    id: "real-unresolved-genuine-fixed-reference-loan-program",
    sourceServiceId: "149200000009",
    sourceField: "criteria",
    text: "월평균 소득이 3인 가구 기준 중위소득 2분의 1 이하인 노동자",
    expectation: { expectUnresolved: true },
    note: "근로복지공단 생활안정자금 융자: per `docs/median-income-fixed-reference-review.md` (#2, class A), this is one of only 7/15 real fixed-reference hits CONFIRMED genuinely fixed via external corroboration (a documented national loan-program standard, independent of the applicant's real household size) -- yet the production parser still safely resolves it to unresolved, for THREE independent reasons: (1) `fixed_reference_household` is never auto-inferred from text at all anymore (checkpoint-4 fix), (2) this excerpt uses Korean fraction notation ('2분의 1') instead of a literal '%' digit, which `MEDIAN_INCOME_PERCENT_RE` deliberately does not support, and (3, checkpoint-5) there is no positive household-income label nearby either ('노동자' names the applicant, not the income scope). Proves the conservative fallback holds for a real A-classified case via multiple independent, redundant safety mechanisms.",
  },
  {
    id: "real-unresolved-fixed-target-population-bare-median-income",
    sourceServiceId: "314000000271",
    sourceField: "target",
    text: "지원대상: 사회적 고립가구 중 결식우려 1인가구 (기초생활수급자·차상위계층 또는 중위소득100% 이하)",
    expectation: { expectUnresolved: true },
    note: "양천 반올림 밑반찬 지원 사업: per the checkpoint-4 review (#3, class A) -- target population is explicitly '1인가구' so a fixed 1-person reference would actually be correct BY CONSTRUCTION here, but the parser still conservatively falls back to unresolved: the household-size guard fires on the nearby '1인가구'/'고립가구' mentions, and (checkpoint-5) there is also no positive household-income label directly scoping the '중위소득100%' figure itself. Also exercises the bare '중위소득100%' (no 기준 prefix, no space before the digits) wording variant.",
  },

  // -- ambiguous: no percent digit at all near a household-size mention ----
  {
    id: "real-unresolved-no-percent-digit",
    sourceServiceId: "149200000018",
    sourceField: "target",
    text: "○ 월평균소득이 보건복지부 장관이 고시하는 3인 가구 기준 중위소득 이하인 자로 다음에 해당하는 자",
    expectation: { expectUnresolved: true },
    note: "산재근로자 생활안정자금 융자: real example with a boundary word ('이하') but NO percent digit anywhere nearby (the clause means 'at or below the (100%) 3-person median income figure', a bare comparison with an implicit 100%) -- `MEDIAN_INCOME_PERCENT_RE` requires an explicit digit run before '%', so this correctly falls back to unresolved rather than guessing percent=100 (this early return happens before the checkpoint-5 positive-signal check is ever reached).",
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

  // -- wage/earned income (임금/근로소득), not household income -- checkpoint-5
  {
    id: "real-unresolved-wage-income-disqualifier",
    sourceServiceId: "515000000168",
    sourceField: "target",
    text: "관내 중소·중견기업에 주30시간 이상 근무하고, 3개월 이상 근무중인 만 19세~39세 미혼 청년\n임금이 2026년 기준 중위소득 150% 이하인 자",
    expectation: { expectUnresolved: true },
    note: "청년근로자 사랑채움 사업: REQUIRED CORRECTION -- this is the exact record the external review flagged as a checkpoint-4 false positive. '임금이 ... 이하인 자' ('a person whose WAGE is at or below ...') scopes the comparison to the applicant's individual wage/earned income, not household income; checkpoint-4 wrongly emitted a `median_income_threshold` rule here solely because no then-known disqualifier matched (there was no wage-income disqualifier category at all). `MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE` (checkpoint-5, matching '임금') now correctly routes this to unresolved. Also co-extracts an age-range rule from the same text, confirming the wage disqualifier doesn't block unrelated age-dimension extraction.",
  },

  // -- couple-combined income (부부합산/본인·배우자 합산), not household income --
  // -- checkpoint-5 ----------------------------------------------------------
  {
    id: "real-unresolved-couple-income-disqualifier",
    sourceServiceId: "402000000115",
    sourceField: "target",
    text: "부부합산 소득 기준 중위소득 180% 이하 무주택 신혼부부(전용면적 85㎡ 이하 주택)",
    expectation: { expectUnresolved: true },
    note: "군포시 신혼부부 전월세 보증금 대출이자 지원: clean, minimal real example of `MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE`'s '부부합산 소득' branch. Per the external review: a married couple's combined income is NOT necessarily identical to the full household income (a household may also contain other income-earning members, e.g. parents or adult children living together) -- this Phase does not add a couple-income profile field/UI, so this clause stays unresolved rather than being misapplied against `householdIncomeRange`.",
  },
  {
    id: "real-unresolved-couple-income-combined-self-spouse-with-footnote",
    sourceServiceId: "519000000153",
    sourceField: "target",
    text: "본인·배우자 합산 연소득이 기준 중위소득 180%* 이하\n      * 2025년 기준 : 월6,840,000원(2인가구) / 연82,080,000원(2인가구)",
    expectation: { expectUnresolved: true },
    note: "청도군 신혼부부 주거자금 대출이자 지원: MECHANISM CORRECTED under checkpoint-5. Under checkpoint-4 this sample's note claimed the household-size footnote ('(2인가구)') was what forced this to unresolved (a nearby household-size number). Re-verified directly: even with that footnote entirely removed, this clause is STILL unresolved -- '본인·배우자 합산' now matches `MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE` directly and unconditionally, before the household-size guard is ever reached. Documented honestly here per the project's 'do not encode a known limitation as correct' mandate: the OUTCOME didn't change, but the REASON did, and the old note would have been actively misleading about which real mechanism governs this record.",
  },

  // -- category/status wording that must not block extraction ---------------
  {
    id: "real-rule-status-category-wording-not-blocking",
    sourceServiceId: "511000000155",
    sourceField: "target",
    text: "□ 참여자격: 공고일 현재 상주시에 거주하는 만18세 이상 근로능력자(외국인 등록번호를 소지한 자 포함)로서 가구소득이 기준중위소득 60%이하이면서 재산이 4억원 미만인 가구의 구성원 . 단, 사업개시일 현재 만 34세 이하인 청년 미취업자는 소득 및 재산과 무관하게 참여 가능",
    expectation: {
      expectedRule: {
        percent: 60,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "공공일자리 제공(공공근로서비스, 지역공동체일자리): CHECKPOINT-6 REPLACEMENT (task-item-2 42-hit review, see docs/median-income-42-hit-review.md). The PREVIOUS sample at this id (서비스ID 654000000006, '가구소득평가액이 기준중위소득 50%이하') is itself one of the 6 false positives that review found: 소득평가액 (income-assessment amount) is now a recognized disqualifier (checkpoint-6), so that record correctly moved to unresolved and is no longer a valid 'rule' example -- see `real-unresolved-metric-disqualifier-income-assessment-amount` below. This replacement's '가구소득' label directly precedes the anchor, and the trailing status/category wording ('근로능력자(외국인 등록번호를 소지한 자 포함)' before the anchor, '가구의 구성원' and the '단, ... 참여 가능' carve-out after it) does not disqualify the match: none of it is one of the metric-disqualifier tokens (소득인정액/소득평가액/건강보험료/개인소득/종합소득/임금/근로소득/부부합산/원가구).",
  },
  {
    id: "real-unresolved-metric-disqualifier-income-assessment-amount",
    sourceServiceId: "654000000006",
    sourceField: "target",
    text: "전북에 주소를 둔지 1개월이상, 가구소득평가액이 기준중위소득 50%이하, 부양의무자가 고소득자(연 1.3억 원)을 초과하는 경우 지원불가",
    expectation: { expectUnresolved: true },
    note: "전북형 기초생활보장제도: CHECKPOINT-6 CORRECTION (task-item-2 42-hit review). Previously accepted as a RULE under checkpoint-5 because '가구소득평가액' satisfied the positive-signal regex and no then-known disqualifier recognized '소득평가액' specifically. 소득평가액 is the pre-asset-conversion component of 소득인정액 under Korean welfare law -- an administrative metric, not raw household income. `MEDIAN_INCOME_METRIC_DISQUALIFIER_RE` now also matches '소득평가액', so this correctly falls back to unresolved.",
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
    sourceServiceId: "642000000712",
    sourceField: "target",
    text: "○ 공고일 기준 강원특별자치도 거주, 최종학력 기준 졸업(중퇴), 만18세~45세이하 미취업 청년\n -최근 3개월 가구소득액 평균이 기준중위소득 120%초과 ~ 180%이하(만18세~34세 이하), 기준중위소득 180%이하(만35세~45세 이하)",
    expectation: {
      expectedRule: {
        percent: 120,
        boundary: "gt",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "강원특별자치도 청년 취업준비 쿠폰 지원: CHECKPOINT-5 REPLACEMENT (the old sample, 서비스ID 443000000661 '기준중위소득 180% 이하 청년', had no positive household-income label at its first anchor and is now unresolved). REQUIRED CATEGORY: AND structure, across dimensions (median income AND age AND region, no 또는/혹은 anywhere) -- all co-extracted correctly without the cross-dimension-OR safety net wrongly firing. '가구소득액 평균' directly precedes the anchor. Only the FIRST percent+boundary pair in the whole text is captured (120% 초과); the two LATER thresholds in the same sentence (180% 이하 for 18-34, and a wholly separate 180% 이하 for 35-45) are silently not captured as additional rules, per this parser's single-match design.",
  },
  {
    id: "real-limitation-and-structure-within-median-income-only-first-captured",
    sourceServiceId: "161300000099",
    sourceField: "criteria",
    text: "ㅇ (소득) 청년 원가구*의 소득이 기준 중위소득 100% 이하이면서 청년 독립가구 소득이 기준 중위소득 60% 이하",
    expectation: { expectUnresolved: true },
    note: "청년월세 지원: CHECKPOINT-6 CORRECTION (task-item-2 42-hit review, see docs/median-income-42-hit-review.md and `real-unresolved-parental-origin-household-disqualifier` below). Under checkpoint-5 this was WRONGLY accepted as a RULE (100% lte) purely because '원가구*의 소득' satisfied the positive-signal regex and 원가구/독립가구 were not yet recognized as a semantic mismatch -- this was itself a genuine AND ('이면서') of TWO separate median-income thresholds on two DIFFERENT income bases (원가구 100% 이하 AND 독립가구 60% 이하), neither of which is the applicant's own current household as Damoa's `annualHouseholdIncome` represents it. `MEDIAN_INCOME_PARENTAL_ORIGIN_HOUSEHOLD_DISQUALIFIER_RE` (checkpoint-6) now correctly disqualifies the whole clause. This id is kept (rather than renamed) to preserve the AND-structure-within-median-income category coverage, now honestly demonstrating the SAFE outcome (unresolved) rather than the previously-wrong RULE outcome; see `real-rule-multiple-percentages-first-occurrence-wins` for a still-passing example of the general first-occurrence-only limitation on a record that does emit a rule.",
  },
  {
    id: "real-unresolved-parental-origin-household-disqualifier",
    sourceServiceId: "161300000099",
    sourceField: "target",
    text: "계약일자·기간 등 기재 필요) ㅇ (소득) 청년 원가구*의 소득이 기준 중위소득 100% 이하이면서 청년 독립가구 소득이 기준 중위소득 60% 이하 * (원가구) 청년 + 부모 + 부모와 동일 주소",
    expectation: { expectUnresolved: true },
    note: "청년월세 지원 (지원대상 field, with the trailing '* (원가구) 청년 + 부모 + 부모와 동일 주소' footnote definition included verbatim): REQUIRED CHECKPOINT-6 CATEGORY -- 원가구 (parental-origin household) vs. 독립가구 (applicant's own independent household). Real youth-housing programs test BOTH via AND; neither figure is safely comparable to `annualHouseholdIncome` (the applicant's own current household), so the clause correctly stays unresolved.",
  },

  // -- multiple median-income percentages in one source ----------------------
  {
    id: "real-rule-multiple-percentages-first-occurrence-wins",
    sourceServiceId: "149200000037",
    sourceField: "target",
    text: "○  140시간 이상 직업훈련*에 참여하는 비정규직 근로자, 전직실업자, 무급휴직자, 자영업자인 피보험자 중 \n     가구원 합산 소득이 기준 중위소득의 80% 이하인 자\n     - 첨단산업 디지털 핵심 실무인재 양성훈련, 중장년내일센터 프로그램 참여자의 경우 기준 중위소득의 100%이하인 자, 국가기간산업직종 훈련 참여자의 경우 기준 중위소득의 120%이하인 자\n     - 전직실업자인 경우 실업급여 수급중인 자는 제외\n       * 직업훈련: 「국민 평생 직업능력 개발법」에 의해 지원되는 국민내일배움카드 과정(원격훈련은 비대면 실시간 훈련에 한정), 사업주 직업능력개발훈련, 폴리텍대학 전문기술(기능사)과정, 「고용보험법」및 「국민 평생 직업능력 개발법」에 의해 지원되는 국가인적자원개발컨소시엄 훈련과정 등",
    expectation: {
      expectedRule: {
        percent: 80,
        boundary: "lte",
        incomeMetric: "household_income",
        householdSizeMode: "scales_with_profile_household",
      },
      expectUnresolved: false,
    },
    note: "직업훈련 생계비대부사업: CHECKPOINT-5 REPLACEMENT (the old sample, 서비스ID 179038700004, had no positive household-income label at its first anchor and is now unresolved). REQUIRED CATEGORY -- multiple median-income percentages in one source (80/100/120%, one per training-program sub-track). The parser deterministically resolves only the FIRST occurrence in raw text order ('가구원 합산 소득' 80%, which also happens to be the only one of the three with a positive household label directly attached) -- the two later, more specific per-program percentages (100%, 120%) are silently not captured as separate rules. Documented as a real limitation, not fixed here: disambiguating which of several program-scoped percentages applies to THIS specific applicant sub-track would require program-specific knowledge this generic text parser doesn't have. Also proves category/status wording ('비정규직 근로자, 전직실업자, 무급휴직자, 자영업자인 피보험자') sitting directly adjacent to the anchor does not block extraction.",
  },

  // -- checkpoint-6 (task-item-2 42-hit review): positive-regex/중위소득 -----
  // -- collision bug -- see docs/median-income-42-hit-review.md -------------
  {
    id: "real-unresolved-positive-regex-collision-national-reference-household",
    sourceServiceId: "373000000126",
    sourceField: "target",
    text: "기분(정동)장애일부로 최초 진단받은 후 5년 이내인 환자로서 전국가구 중위소득의 120%이하",
    expectation: { expectUnresolved: true },
    note: "정신질환자 치료비 지원: CHECKPOINT-6 CORRECTION. Previously accepted as a RULE under checkpoint-5 because `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE`'s bounded wildcard gap ('가구' ... [^\\n]{0,4} ... '소득') bridged INTO the trailing '소득' of '중위소득' itself ('가구' + ' 중위' (2 gap chars) + '소득' matched under the old regex). '전국가구' ('nationwide households', a reference population) is also not the applicant's own household even if a genuine label had been present. The `(?!중위)` negative lookahead added to the wildcard gap now blocks this bridging, and there is no other genuine positive household-income phrase in this text, so it correctly falls back to unresolved.",
  },
  {
    id: "real-unresolved-positive-regex-collision-category-label",
    sourceServiceId: "315000000104",
    sourceField: "target",
    text: "○ 관내 주민등록을 두고, 법정 저소득 한부모가구(중위소득65% 이하) 지원(단, 생계, 의료급여 지원가구는 제외)",
    expectation: { expectUnresolved: true },
    note: "저소득 한부모 명절위문금 지원: CHECKPOINT-6 CORRECTION, same bridging bug as `real-unresolved-positive-regex-collision-national-reference-household` above -- the '(' immediately after '가구' plus the leading '중' of '중위' fit inside the old regex's 4-char gap budget, bridging all the way to '중위소득''s own trailing '소득'. '저소득 한부모가구' is a certified target-category label, not a direct positive household-income statement. Now correctly unresolved.",
  },

  // -- checkpoint-6 (task-item-2 42-hit review): disqualifier-only window ---
  // -- widened to reach a trailing footnote -- see docs/median-income-42-  --
  // -- hit-review.md ----------------------------------------------------------
  {
    id: "real-unresolved-disqualifier-window-widened-sodeukinjeongaek-footnote",
    sourceServiceId: "461000000126",
    sourceField: "target",
    text: "○ (소득기준) 기준중위소득 140% 초과자\r\n     * 소득기준 :  신청가구의 소득과 재산을 종합적으로 반영한 소득인정액 \r\n     * 신청가구는 '서비스 이용자' 및 '배우자'(주민등록 등본상에 기재)로 한정",
    expectation: { expectUnresolved: true },
    note: "치매 진료비 및 약제비 본인부담금 지원: CHECKPOINT-6 CORRECTION. Previously accepted as a RULE (140% gt) under checkpoint-5: the narrow ±40/+20-char window used for the disqualifier check ended before reaching the trailing '* 소득기준 : ... 소득인정액' footnote (~34 chars past the match in the real record). The disqualifier-only check window (not the positive-signal window) is now widened to +150 chars, so it correctly reaches '소득인정액' and falls back to unresolved. Note the genuine positive-signal label ('신청가구의 소득') is itself INSIDE this same footnote -- proves the fix deliberately widens ONLY the disqualifier window, not the positive-signal window, since widening the latter could introduce new false positives.",
  },

  // -- percent expressed as the WORD '퍼센트', not the '%' symbol ------------
  {
    id: "real-unresolved-percent-word-not-symbol",
    sourceServiceId: "644000000230",
    sourceField: "target",
    text: "월 소득액이 국민기초생활보장법 제2조제11호에 따른 기준중위소득 100퍼센트 이하인 가구(세대)",
    expectation: { expectUnresolved: true },
    note: "민주화운동 관련자 예우 및 지원: real example using the WORD '퍼센트' instead of the '%' symbol -- `MEDIAN_INCOME_PERCENT_RE` only matches a literal '%' sign, so this correctly falls back to unresolved (a deliberate scope limit, not a bug: supporting the word form would require a much broader, riskier number-word grammar). This early return happens before the checkpoint-5 positive-signal check is ever reached, even though '가구(세대)' at the end of this text would otherwise have satisfied it.",
  },
];
