/**
 * Hand-reviewed, stratified gold sample built from REAL public MOIS (정부24 /
 * Gov24, api.odcloud.kr/api/gov24/v3) 지원대상 (`target`) / 선정기준 (`criteria`)
 * eligibility text — unlike `regionGoldSample.ts` (authored representative
 * sentences), every `text` here is a VERBATIM excerpt copied from a live
 * MOIS API response, with only whitespace/line-break normalization applied
 * (matching the same `\s+` collapsing `normalizeText` already does in
 * `koreanEligibilityParser.ts` — no wording, ordering, or punctuation was
 * changed). `sourceServiceId` + `sourceField` are kept so any entry can be
 * traced back to the exact live record it came from.
 *
 * Snapshot provenance: fetched via the same pattern as
 * scripts/benchmarkRegionExtraction.ts (MOIS_API_KEY, /serviceList
 * endpoint), full 10,967-row catalog, on the date this file was added. MOIS
 * data changes over time (programs close, eligibility text gets edited) —
 * this is a frozen point-in-time excerpt, not a live query, which is exactly
 * why it's suitable as a regression fixture.
 *
 * Every entry's `expectation` was decided by manual review of the ACTUAL
 * real-world text (see `note` for the reasoning), not by running the
 * extractor and copying whatever it produced — except where a `note`
 * EXPLICITLY says otherwise (a handful of entries intentionally document a
 * known, pre-existing, out-of-scope extractor limitation surfaced by real
 * MOIS phrasing; see each such note for detail). If a future change to
 * `parseRegionClause` flips any entry NOT flagged as a known limitation,
 * that's a real regression signal requiring a human look — see
 * __tests__/eligibility/regionGoldSampleReal.test.ts.
 */

import type { RegionGoldExpectation } from "./regionGoldSample";

export interface RegionGoldSampleReal {
  id: string;
  /** The MOIS 서비스ID this excerpt was copied from — traces back to the exact live record. */
  sourceServiceId: string;
  /** Which MOIS field the excerpt came from: 지원대상 ("target") or 선정기준 ("criteria"). */
  sourceField: "target" | "criteria";
  text: string;
  expectation: RegionGoldExpectation;
  note: string;
}

export const REGION_GOLD_SAMPLES_REAL: RegionGoldSampleReal[] = [
  // -- Correct region extraction (rule) ------------------------------------
  {
    id: "real-rule-lone-city-yongsan",
    sourceServiceId: "302000000102",
    sourceField: "target",
    text: "○ 용산구에 연속하여 3년 이상 주민등록을 두고 계신 100세 도래 어르신",
    expectation: { outcome: "rule", value: [{ province: "서울특별시", city: "용산구" }] },
    note: "장수축하금 지급 (용산구): real lone-city mention, unambiguous, resolved via gazetteer.",
  },
  {
    id: "real-rule-lone-city-jongno",
    sourceServiceId: "300000000108",
    sourceField: "target",
    text: "○ 출산장려 건강보험료 지원 - 지원대상 : 부 또는 모와 함께 종로구에 주민등록을 두고 거주하고 있는 둘째 이상의 영유아 - 지원자격 : 부 또는 모의 거주기간은 10개월 이상 ㆍ 거주기간 10개원 이상인 경우 : 신청월 다음달에 지원 ㆍ 거주기간 10개월 미만인 경우 : 10개월 경과일의 다음달에 지원",
    expectation: { outcome: "rule", value: [{ province: "서울특별시", city: "종로구" }] },
    note: "출산장려 건강보험 가입지원 (종로구): lone-city mention resolves cleanly even though the surrounding text has an unrelated 부/모 '또는' that does NOT trip the OR-safety-net here (only 1 rule total is extracted from this text).",
  },
  {
    id: "real-rule-short-district-with-province",
    sourceServiceId: "301000000103",
    sourceField: "target",
    text: "○ 지급기준일이 속한 달의 전월부터 서울특별시 중구에 주민등록이 되어 있는 국가보훈대상자 및 선순위유족(수권자) ※ 다음 각 호의 어느 하나에 해당하는 국가보훈대상자 및 선순위유족 1. 「국가유공자 등 예우 및 지원에 관한 법률」 및 「국가유공자 등 단체설립에 관한 법률」 2. 「참전유공자예우 및 단체설립에 관한 법률」 3. 「고엽제후유의증 등 환자지원 및 단체설립에 관한 법률」 4. 「특수임무유공자 예우 및 단체설립에 관한 법률」 5. 「독립유공자예우에 관한 법률」 6. 「5·18민주유공자 예우에 관한 법률」",
    expectation: { outcome: "rule", value: [{ province: "서울특별시", city: "중구" }] },
    note: "국가보훈대상자 보훈예우수당 (서울특별시 중구): REAL-WORLD instance of the task's canonical short-district example — a real short (1-char-stem) district name (중구, ambiguous across 5 metros on its own) paired with an explicit province in the same clause, correctly resolved to a specific city rather than falling back to province-only or unresolved.",
  },
  {
    id: "real-rule-province-and-city-seongdong",
    sourceServiceId: "303000000111",
    sourceField: "target",
    text: "○ 서울특별시 성동구에 영아의 출생일 포함 1년 이상 계속하여 영아와 동일 세대로 주민등록을 두고 실제 거주하는 부 또는 모가 셋째아 이상 출산 시",
    expectation: { outcome: "rule", value: [{ province: "서울특별시", city: "성동구" }] },
    note: "출생축하금 지원 (성동구): direct province+city adjacency, real phrasing.",
  },
  {
    id: "real-rule-multi-region-large-list",
    sourceServiceId: "135200005017",
    sourceField: "target",
    text: "○ (1단계 시범사업 대상지역) 서울 종로구, 경기 부천시, 충남 천안시, 전남 순천시, 경북 포항시, 경남 창원시('22.7~2024. 12. 31 종료) ○ (2단계 시범사업 대상지역) 경기 안양시, 경기 용인시, 대구 달서구, 전북 익산시('23.7~) ○ (3단계 시범사업 대상지역) 충북 충주시, 충남 홍성군, 전북 전주시, 강원 원주시('24.7~) ○ (기본 자격) 시범사업 지역 거주 취업자 또는 시범사업 지역 소재 사업장 근로자(거주지 무관), 만 15세 이상 ~ 만 65세 미만 대한민국 국적자(난민 등 일부 외국인 예외 적용) ○ (취업자 기준) ① 건강보험 직장가입자(직전 2개월(60일) 동안 30일 이상 가입 자격 유지), ② 고용보험 또는 산재보험 가입자(직전 2개월(60일) 동안 30일 이상 가입 자격 유지, 일용근로자의 경우 직전 1개월 간 10일 이상 또는 2개월 중 20일 이상 가입한 경우 인정), ③ 사업 기간 및 매출 기준을 충족하는 자영업자(직전 3개월 동안 사업자등록 유지 + 직전 3개월 월평균 매출액 206만원 이상) * 단, 시범사업 기간 동안 한시적으로 직전 3개월 중 1개월 이상 매출이 206만원 이상인 경우 예외 인정 ○ (소득·재산 기준) 2·3단계 시범사업에만 해당 ① 가구 합산 건강보험료 기준중위소득 120% 이하 ○ (가구원) 동일 주민등록표에 기재된 민법상 가족(2촌 이내) 일부 비동거 가족* * 배우자 및 만 25세 미만 자녀, 피부앵자 세대 동일 건강보험증 상 비동거 가족",
    expectation: {
      outcome: "rule",
      value: [
        { province: "서울특별시", city: "종로구" },
        { province: "경기도", city: "부천시" },
        { province: "충청남도", city: "천안시" },
        { province: "전라남도", city: "순천시" },
        { province: "경상북도", city: "포항시" },
        { province: "경상남도", city: "창원시" },
        { province: "경기도", city: "안양시" },
        { province: "경기도", city: "용인시" },
        { province: "대구광역시", city: "달서구" },
        { province: "전북특별자치도", city: "익산시" },
        { province: "충청북도", city: "충주시" },
        { province: "충청남도", city: "홍성군" },
        { province: "전북특별자치도", city: "전주시" },
        { province: "강원특별자치도", city: "원주시" },
      ],
    },
    note: "한국형 상병수당 시범사업: real 14-region pilot-program rollout list spanning 10 different provinces and one short district (대구 달서구). This is the densest real multi-region text found in the catalog. RESTORED by the MOIS region-parser Section 2 anaphora fix (Pattern B: `resolveNamedRegionListAnaphora`): the 14 region mentions are an explicitly-defined named region SET spelled out across three separate ○-delimited enumeration clauses ('1단계'/'2단계'/'3단계 시범사업 대상지역'), and the ONLY residence signal ('시범사업 지역 거주') is a later, separate ○-clause ('기본 자격') that back-references that whole named set as a single anaphoric unit ('시범사업 지역') rather than re-listing it — a structurally safe, unambiguous whole-set back-reference (not the same shape as the confirmed false positive in MOIS 351050000123, where unrelated LATER-clause province mentions — an employer/interview location, never named as a set anywhere else in the field — were wrongly absorbed into the residence rule). Previously (pre-Section-2) this field lost its region rule entirely because the parser required the region mention and residence signal to sit in the same clause; it is now one of the 6 fields restored by anaphora/disambiguation (docs/audits/mois-region-parser-closeout.json, section12_fullCatalogSafety.fieldRulesRestoredByAnaphoraOrDisambiguation).",
  },

  // -- No region restriction (no_rule) --------------------------------------
  {
    id: "real-no-rule-generic-community",
    sourceServiceId: "135200000080",
    sourceField: "target",
    text: "○ 지역사회 주민",
    expectation: { outcome: "no_rule" },
    note: "치매관리 서비스 (치매안심센터): generic '지역사회 주민' (community residents) claim with no specific place name — nothing to anchor a rule to, same category as the authored 'nationwide-no-place-name' case but from real text.",
  },
  {
    id: "real-no-rule-registration-number-not-place",
    sourceServiceId: "135200005015",
    sourceField: "target",
    text: "출생아로서 출생신고되어 정상적으로 주민등록번호를 부여받은 아동(주민등록상 생년월일로부터 1년이 초과되지 않는 출생아) * 2024년 1월 1일 이후 출생아는 주민등록상 생년월일로부터 2년내에 신청하여 사용 가능",
    expectation: { outcome: "no_rule" },
    note: "첫만남이용권 지원: '주민등록' appears twice but refers to a registration NUMBER / birthdate-of-record, never a place name — correctly produces no region rule and no unresolved noise.",
  },
  {
    id: "real-no-rule-institution-mention-no-residence-signal",
    sourceServiceId: "304000000192",
    sourceField: "target",
    text: "광진구 내 설치된 무인민원발급기 사용자 ※ 설치장소 : 광진구청 홈페이지 확인",
    expectation: { outcome: "no_rule" },
    note: "무인민원발급기 수수료 면제: '광진구' names a location but the clause has no residence keyword (거주/주민등록/주소지/주민) at all, so the region parser never even runs — a real institution/location mention that is correctly NOT a residence condition.",
  },
  {
    id: "real-no-rule-place-list-without-residence-signal",
    sourceServiceId: "148000000034",
    sourceField: "target",
    text: "○ 상수원관리지역 관할 8개시군(순천시, 광양시, 담양군, 보성군, 화순군, 강진군, 장흥군, 영암군)",
    expectation: { outcome: "no_rule" },
    note: "영산강섬진강수계 주민지원(특별지원사업): names 8 real, unambiguous cities/counties (all in 전라남도) but this specific clause never asserts that the APPLICANT must reside there (no 거주/주민등록/주소지/주민 keyword in this excerpt) — it's describing the administrative catchment area, not an eligibility condition, so correctly produces no rule.",
  },

  // -- Ambiguous / unresolved -------------------------------------------------
  {
    id: "real-unresolved-ambiguous-goseong-1",
    sourceServiceId: "434100000004",
    sourceField: "target",
    text: "고성군에 주민등록을 두고있는 군민(등록외국인 포함)",
    expectation: { outcome: "unresolved" },
    note: "고성군민안전보험: 고성군 exists in both 강원특별자치도 and 경상남도 with no province stated anywhere in this text — genuinely ambiguous, correctly left unresolved rather than guessed.",
  },
  {
    id: "real-unresolved-ambiguous-goseong-2",
    sourceServiceId: "542000000121",
    sourceField: "target",
    text: "○ 고성군에 주민등록을 둔 13~18세 청소년(연나이 기준)",
    expectation: { outcome: "unresolved" },
    note: "고성군 청소년 꿈키움 바우처 지원: second independent real-world 고성군-ambiguity example (from a different program/district office than the previous entry), confirming the ambiguity isn't a one-off in this snapshot.",
  },
  {
    id: "real-unresolved-ambiguous-gangseo",
    sourceServiceId: "315000000109",
    sourceField: "target",
    text: "○ 강서구 거주 저소득주민 중 국민건강보험료 부과금액이 월 최저 보험료 이하의 세대이면서 65세 이상 노인으로만 구성된 세대 또는 등록장애인이 포함된 세대",
    expectation: { outcome: "unresolved" },
    note: "저소득주민 국민건강보험료 등 지원: 강서구 exists in both 서울특별시 and 부산광역시, no province stated — genuinely ambiguous, correctly unresolved.",
  },
  {
    id: "real-unresolved-bare-short-district",
    sourceServiceId: "301000000106",
    sourceField: "target",
    text: "○ 중구 관내 거주 만65세 이상 기초생활수급자, 차상위계층, 기초연금 수급자",
    expectation: { outcome: "unresolved" },
    note: "중구 어르신 영양더하기 카드 안내: real MOIS text where a 중구 district office publishes its OWN program without ever stating its province in the eligibility text itself. Even though a human reader familiar with the program name ('중구...카드 안내') might guess which 중구, the ELIGIBILITY TEXT alone is genuinely ambiguous (중구 exists in 5 metros) — correctly left unresolved rather than guessed from the program title.",
  },

  // -- Formerly-known-limitations, fixed by Phase 1 --------------------------
  // (These three entries used to document real, out-of-scope extractor
  // limitations: the whole-document `detectLogicalConnective` OR check and
  // the raw unvalidated `주민등록법`-triggers-hasResidenceSignal bug. Phase 1
  // item B (statute/document-name-aware residence-signal detection) and item
  // C (clause-local, per-OR-occurrence cross-dimension check) fix both root
  // causes — see `koreanEligibilityParser.ts`. Kept here, not deleted, with
  // updated expectations, so a future regression on these exact real records
  // still has a fixture to catch it.)
  {
    id: "real-rule-numbered-list-or-unrelated-subject",
    sourceServiceId: "304000000105",
    sourceField: "target",
    text: "본인 또는 배우자가 출산한 만 7세 미만의 아동을 양육하면서 신청일 기준으로 1년 전부터 계속하여 광진구에 주민등록을 두고 거주하는 장애인(2022.7. 조례개정)",
    expectation: { outcome: "rule", value: [{ province: "서울특별시", city: "광진구" }] },
    note: "장애인가정 양육지원금 지급 (Phase 1 fix confirmed): 광진구 is unambiguous and correctly resolves to {서울특별시, 광진구}, and '7세 미만' resolves to an age rule. The unrelated '본인 또는 배우자' (self-or-spouse) OR is nowhere near either extracted signal (age/region trigger substrings), so the clause-local OR check (`hasLocalCrossDimensionOr`) correctly does NOT treat it as joining the age and region dimensions — previously the whole-document `detectLogicalConnective` check wiped both rules just because '또는' existed anywhere in the text.",
  },
  {
    id: "real-rule-numbered-list-or-unrelated-subject-2",
    sourceServiceId: "315000000268",
    sourceField: "target",
    text: "① 서울특별시 강서구에 주민등록이 되어 있는 자 ② 서울특별시 강서구의 주택을 임차한 사람 중 1) 특별법에 따라 국토교통부 장관이 결정한 전세사기피해자 또는 2) HUG 전세피해확인서 발급자(전세피해자) ③새로운 전·월세 주택으로 입주하여 「전세보증금 반환보증 보증료」 를 납부한 자 * 사업공고일 이전에 전세피해로 이미 전·월세 주택에 입주한 세대도 지원신청 가능 ※ 신청일 현재 무주택자인 자 ※ 정부, 타 자치단체에서 유사한 목적의 지원을 받은 경우 중복 지원 불가",
    expectation: {
      outcome: "rule",
      value: [
        { province: "서울특별시", city: "강서구" },
        { province: "서울특별시", city: "강서구" },
      ],
    },
    note: "강서구 전세피해지원금(보증료) 지원 (Phase 1 fix confirmed): explicitly states '서울특별시 강서구' twice (once per province mention, hence the duplicate spec — findProvinceRegionSpecs resolves each independent province mention on its own and does not cross-mention-dedupe, which is harmless for region_in matching), and '무주택자인 자' resolves to a homeowner:false rule. The numbered-option '또는' between sub-items 1) and 2) sits nowhere near either signal's trigger substring, so the clause-local OR check correctly leaves both rules intact — previously the whole-document OR check wiped both just because '또는' existed anywhere in the text.",
  },
  {
    id: "real-no-rule-statute-name-not-residence",
    sourceServiceId: "305000000157",
    sourceField: "target",
    text: "- 무인민원발급창구 이용 민원 ※ 동대문구 무인민원발급기 설치장소 : 동대문구청 홈페이지 확인 - 발급 민원증명 관련 법령·조례에 의한 수수료 면제 대상(예 : 주민등록법 시행규칙 제18조 제1항에 따른 수급자 면제)",
    expectation: { outcome: "no_rule" },
    note: "무인민원발급기 수수료 면제 (Phase 1 fix confirmed): the institution-mention guard correctly rejects '동대문구청' as a district-office address, same as `real-no-rule-institution-mention-no-residence-signal` above. Previously, a citation of '주민등록법' (Resident Registration Act, a statute name) elsewhere in the text contained the substring '주민등록' and incorrectly tripped `hasResidenceSignal`, producing a noisy 'unresolved' instead of cleanly short-circuiting to no_rule. Phase 1 item B's statute/document-name-aware residence-signal detection now excludes '주민등록법' (and '주민등록증'/'표'/'번호'/'증명서') from counting as a residence signal, so this clause never even reaches the region-token logic.",
  },
];
