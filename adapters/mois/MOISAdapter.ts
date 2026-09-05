import type {
  Benefit,
  BenefitType,
  EligibilityRule,
  EligibilityRuleGroup,
  InstitutionType,
} from "@/types/benefit";
import { parseMOISUserScope } from "@/lib/eligibility/targetScope";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import { parseMoisDeadline } from "@/lib/eligibility/extraction/moisDeadlineParser";
import {
  deriveFinancialFacets,
  finalizeTopics,
  hasAssetBuildingSignal,
  hasChildcareSignal,
  hasHousingSignal,
  primaryCategory,
  STARTUP_WORDS,
  TRANSPORT_WORDS,
  type BenefitFinancialFacet,
  type BenefitTopic,
} from "@/domain/benefit/topics";

/**
 * Raw record shapes confirmed live against the 행정안전부 "대한민국 공공서비스
 * (혜택)" API (api.odcloud.kr/api/gov24/v3, Swagger source:
 * https://infuser.odcloud.kr/oas/docs?namespace=gov24/v3) on 2026-08-31 using
 * a real service key. Field names are the actual Korean keys returned by the
 * live API — NOT guessed from stale documentation. The `serviceList` and
 * `serviceDetail` operations return slightly different field sets (e.g.
 * `서비스목적요약` vs `서비스목적`, `접수기관` vs `접수기관명`), so they get
 * distinct raw types instead of one merged shape.
 */
export interface MOISRawServiceListItem {
  등록일시?: string;
  부서명?: string;
  사용자구분?: string;
  상세조회URL?: string;
  서비스ID: string;
  서비스명: string;
  서비스목적요약?: string;
  서비스분야?: string;
  선정기준?: string;
  소관기관명: string;
  소관기관유형?: string;
  소관기관코드?: string;
  수정일시?: string;
  신청기한?: string;
  신청방법?: string;
  전화문의?: string;
  접수기관?: string;
  조회수?: number;
  지원내용?: string;
  지원대상?: string;
  지원유형?: string;
  [key: string]: unknown;
}

export interface MOISRawServiceDetail {
  공무원확인구비서류?: string;
  구비서류?: string;
  문의처?: string;
  법령?: string;
  본인확인필요구비서류?: string;
  서비스ID: string;
  서비스명: string;
  서비스목적?: string;
  선정기준?: string;
  소관기관명: string;
  수정일시?: string;
  신청기한?: string;
  신청방법?: string;
  온라인신청사이트URL?: string;
  자치법규?: string;
  접수기관명?: string;
  지원내용?: string;
  지원대상?: string;
  지원유형?: string;
  행정규칙?: string;
  [key: string]: unknown;
}

/**
 * Raw record shape from the `supportConditions` operation. Response fields
 * are cryptic condition codes (JA0101..JA2299) rather than human-readable
 * names, and odcloud does not publish a public decoder for most of them.
 * Only the ones we can confirm the meaning of from live data are used —
 * JA0110/JA0111 lined up exactly with "만 3~5세" (age 3~5) eligibility text
 * on a real record, so we treat those two as min/max applicant age. The rest
 * are left untouched rather than guessed.
 */
export interface MOISRawSupportCondition {
  서비스ID: string;
  JA0110?: number | null;
  JA0111?: number | null;
  [key: string]: unknown;
}

/**
 * `서비스분야` values confirmed LIVE (frozen catalog, 13,712-item snapshot,
 * cross-topic-precision audit, checkpoint 4) to be a combined bucket joining
 * two genuinely unrelated concepts with "·" — exactly the same
 * umbrella-pollution shape as Youth Center's `lclsfNm` "금융·복지·문화" (see
 * docs/beta-personalization-audit.md §4), just not previously caught because
 * this checkpoint's audit was the first to check topics other than
 * asset_building:
 *   - "주거·자립" (housing + self-reliance/independence-for-vulnerable-groups):
 *     352/580 (60.7%) of its records have NO housing word anywhere in the
 *     title (자산형성지원사업/희망저축, 북한이탈주민 정착금, 노숙인 복지지원,
 *     가정폭력피해자 자립지원금, 청소년 자립지원 — none of them housing).
 *   - "보육·교육" (early-childhood care + ALL-AGES education, including adult
 *     university scholarships): 1508/1516 (99.5%) of titles don't
 *     independently support BOTH — e.g. "대학원 학과 기반 교육연구단 연구장학금",
 *     "국가장학금 Ⅱ유형", "인문100년장학금" are pure adult-education scholarship
 *     programs with zero childcare relevance, yet the field alone would force
 *     a `childcare` tag.
 *   - "고용·창업" (employment + startup): 758/843 (89.9%) of titles contain no
 *     "창업" word (선원복지고용센터 운영, 전역예정군인 재취업지원, 두루누리 사회보험료
 *     지원 — pure employment, not startup).
 * Every OTHER `서비스분야` value was checked the same way and found safe —
 * notably "임신·출산" (914 records) also has a majority (580/914) of titles
 * without its own literal childcare wordlist match, but every one of those
 * sampled ("임산부", "영유아", "산모", "난임", "출생") IS still genuinely
 * pregnancy/childbirth-adjacent, just phrased with a synonym — a real
 * semantic match, not a forced umbrella tag, so it's kept as-is.
 *
 * These three values are therefore excluded from the topic-classification
 * text (title alone still applies normally) — the exact same "exclude the
 * unsafe umbrella field, keep the specific-word signal" fix already applied
 * to Youth Center's `lclsfNm` for `asset_building`.
 */
const UNSAFE_COMBINED_SEOBISBUNYA = new Set(["주거·자립", "보육·교육", "고용·창업"]);

/**
 * Multi-topic purpose classification (see domain/benefit/topics.ts). Every
 * bucket below is checked independently (not first-match-wins) so a record
 * can genuinely carry more than one topic. `서비스분야` is mostly a proper
 * single-purpose MOIS categorical field, safe to include in the scan — EXCEPT
 * the three confirmed-combined buckets in `UNSAFE_COMBINED_SEOBISBUNYA`
 * above, which are excluded the same way Youth Center's `lclsfNm` umbrella is
 * excluded from the `asset_building` finance scan (see
 * docs/beta-personalization-audit.md §4).
 */
function deriveMoisTopics(raw: MOISRawServiceListItem | MOISRawServiceDetail): BenefitTopic[] {
  const rawField = "서비스분야" in raw && typeof raw.서비스분야 === "string" ? raw.서비스분야 : undefined;
  const field = rawField && !UNSAFE_COMBINED_SEOBISBUNYA.has(rawField) ? rawField : undefined;
  const text = `${field ?? ""} ${raw.서비스명 ?? ""}`;
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  const topics = new Set<BenefitTopic>();
  // "보육" excludes business-incubator false positives — see hasChildcareSignal's docs.
  if (hasChildcareSignal(text, ["보육", "육아", "아동", "출산"])) topics.add("childcare");
  // "임대" excludes non-residential (farmland/equipment/commercial) lease false positives — see hasHousingSignal's docs.
  if (hasHousingSignal(text, ["주거", "주택", "전세", "임대"])) topics.add("housing");
  if (has("교육", "학비", "장학")) topics.add("education");
  if (has("고용", "취업", "일자리", "직업훈련")) topics.add("employment");
  if (has(...STARTUP_WORDS)) topics.add("startup");
  if (has("가족", "한부모", "다문화")) topics.add("family");
  if (has(...TRANSPORT_WORDS)) topics.add("transport");
  // Bare "금융" deliberately excluded — see hasAssetBuildingSignal's docs.
  if (hasAssetBuildingSignal(text)) topics.add("asset_building");
  return finalizeTopics(topics);
}

function deriveMoisFinancialFacets(raw: MOISRawServiceListItem | MOISRawServiceDetail): BenefitFinancialFacet[] {
  const rawField = "서비스분야" in raw && typeof raw.서비스분야 === "string" ? raw.서비스분야 : undefined;
  const field = rawField && !UNSAFE_COMBINED_SEOBISBUNYA.has(rawField) ? rawField : undefined;
  const text = `${field ?? ""} ${raw.서비스명 ?? ""} ${raw.지원유형 ?? ""}`;
  return deriveFinancialFacets(text);
}

function mapBenefitType(지원유형?: string): BenefitType {
  const text = 지원유형 ?? "";
  if (text.includes("현금")) return "cash";
  if (text.includes("대출") || text.includes("융자")) return "loan";
  if (text.includes("이용권") || text.includes("바우처") || text.includes("서비스")) return "service";
  if (text.includes("현물")) return "discount";
  return "other";
}

/**
 * Live MOIS 소관기관유형 values are "중앙행정기관" (central government),
 * "광역시도" (province/metropolitan-city government), and "시군구"
 * (city/county/district government) — NOT "지자체"/"지방", which this
 * function used to check for and which never actually appear in the live
 * API, silently classifying every real local-government record as
 * "government". The Home local-scope-conflict gate (see
 * domain/benefit/localScope.ts) requires `institution.type ===
 * "local_government"` as one of two independent signals before ever
 * demoting a benefit, so this needs to be accurate for that gate to fire on
 * real MOIS local-government records at all.
 */
function mapInstitutionType(소관기관유형?: string): InstitutionType {
  if (!소관기관유형) return "government";
  if (소관기관유형.includes("광역시도") || 소관기관유형.includes("시군구") || 소관기관유형.includes("지자체") || 소관기관유형.includes("지방")) {
    return "local_government";
  }
  return "government";
}

/** Splits MOIS' newline/bullet-delimited document lists into a clean string array. */
function splitDocumentList(text?: string): string[] | undefined {
  if (!text || text === "해당없음") return undefined;
  const items = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*·\s]+/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Eligibility completeness for MOIS records.
 *
 * Beyond applicant age (JA0110/JA0111), 사용자구분 (target scope), and
 * whatever the deterministic text parser lifts out of `선정기준`/`지원대상`,
 * live sampling of `supportConditions` shows dozens of other JA02xx/JA03xx/
 * JA04xx/JA11xx/JA12xx/JA21xx/JA22xx condition codes populated with "Y"/null
 * on the very same records — clearly encoding real eligibility categories
 * (income bracket, household type, disability, region, etc.) that odcloud
 * doesn't publish a decoder for. So a rule group built from age+scope+text
 * is never treated as the FULL picture — it's marked "incomplete", meaning
 * a pass on the rules we do have can't promote a benefit to likely_eligible;
 * only a definite fail from the parsed rules can still produce not_eligible.
 */
function eligibilityDataStatus(eligibility: EligibilityRuleGroup | undefined): Benefit["eligibilityDataStatus"] {
  return eligibility ? "incomplete" : undefined;
}

/**
 * Merges every verified MOIS eligibility source into one rule group:
 *  - `ageEligibility`: applicant age range from `supportConditions`
 *    (JA0110/JA0111), built separately per-service and passed in by the
 *    caller (see MOISBenefitProvider, which shares one conditions map
 *    across all records).
 *  - `사용자구분`: applicant-scope (개인/가구/법인·시설·단체/소상공인), decoded via
 *    `parseMOISUserScope`/`target_scope_in` (see lib/eligibility/targetScope.ts).
 *    An unparseable-but-nonblank value is real data we can't safely turn
 *    into a rule, so it's surfaced via `hasUnresolvedEligibility` instead of
 *    silently dropped.
 *  - `지원대상`/`선정기준`: free text run through the deterministic Korean
 *    parser (see lib/eligibility/extraction/koreanEligibilityParser.ts),
 *    which reports its own unresolved clauses the same way.
 */
function buildEligibility(
  raw: MOISRawServiceListItem | MOISRawServiceDetail,
  ageEligibility?: EligibilityRuleGroup
): { eligibility?: EligibilityRuleGroup; hasUnresolvedEligibility: boolean } {
  const rules: EligibilityRule[] = [];
  let hasUnresolvedEligibility = false;

  if (ageEligibility) {
    // supportConditions only ever produces flat EligibilityRule leaves (see
    // normalizeMOISSupportConditions below), never nested groups.
    rules.push(...(ageEligibility.rules as EligibilityRule[]));
  }

  // `사용자구분` is only documented on `serviceList` records; `serviceDetail`'s
  // type doesn't declare it, so it falls through the index signature as
  // `unknown` — read it defensively rather than assuming its shape.
  const 사용자구분raw = (raw as { 사용자구분?: unknown }).사용자구분;
  const 사용자구분 = typeof 사용자구분raw === "string" ? 사용자구분raw : undefined;

  const scopes = parseMOISUserScope(사용자구분);
  if (scopes) {
    rules.push({
      id: "mois-user-scope",
      field: "사용자구분",
      operator: "target_scope_in",
      value: scopes,
      required: true,
      evidence: { sourceField: "사용자구분", sourceText: 사용자구분, extractionType: "structured_api" },
    });
  } else if (사용자구분 && 사용자구분.trim()) {
    hasUnresolvedEligibility = true;
  }

  const textFields: [string, string | undefined][] = [
    ["지원대상", raw.지원대상],
    ["선정기준", raw.선정기준],
  ];
  for (const [sourceField, text] of textFields) {
    const extracted = extractEligibilityFromText(sourceField, text);
    rules.push(...extracted.rules);
    if (extracted.unresolvedClauses.length > 0) hasUnresolvedEligibility = true;
  }

  if (rules.length === 0) return { eligibility: undefined, hasUnresolvedEligibility };
  return { eligibility: { type: "all", rules }, hasUnresolvedEligibility };
}

export function normalizeMOISServiceListItem(raw: MOISRawServiceListItem, ageEligibility?: EligibilityRuleGroup): Benefit {
  const { eligibility, hasUnresolvedEligibility } = buildEligibility(raw, ageEligibility);
  const deadline = parseMoisDeadline(raw.신청기한);
  const topics = deriveMoisTopics(raw);
  return {
    id: `mois-${raw.서비스ID}`,
    title: raw.서비스명,
    shortDescription: raw.서비스목적요약 || raw.지원내용 || raw.서비스명,
    category: primaryCategory(topics),
    topics,
    financialFacets: deriveMoisFinancialFacets(raw),
    source: { type: "government", organization: raw.소관기관명, providerId: raw.서비스ID },
    benefitType: mapBenefitType(raw.지원유형),
    eligibility,
    eligibilityDataStatus: eligibilityDataStatus(eligibility),
    hasUnresolvedEligibility,
    application: {
      officialUrl: raw.상세조회URL,
      sourceUrl: raw.상세조회URL,
      startDate: deadline.startDate,
      endDate: deadline.endDate,
      deadlineType: deadline.deadlineType,
    },
    institution: { name: raw.소관기관명, type: mapInstitutionType(raw.소관기관유형) },
    tags: raw.서비스분야 ? [raw.서비스분야] : undefined,
    updatedAt: raw.수정일시 ?? raw.등록일시,
    isDemo: false,
  };
}

export function normalizeMOISServiceDetail(raw: MOISRawServiceDetail, ageEligibility?: EligibilityRuleGroup): Benefit {
  const { eligibility, hasUnresolvedEligibility } = buildEligibility(raw, ageEligibility);
  const deadline = parseMoisDeadline(raw.신청기한);
  const topics = deriveMoisTopics(raw);
  return {
    id: `mois-${raw.서비스ID}`,
    title: raw.서비스명,
    shortDescription: raw.서비스목적 || raw.지원내용 || raw.서비스명,
    category: primaryCategory(topics),
    topics,
    financialFacets: deriveMoisFinancialFacets(raw),
    source: { type: "government", organization: raw.소관기관명, providerId: raw.서비스ID },
    benefitType: mapBenefitType(raw.지원유형),
    eligibility,
    eligibilityDataStatus: eligibilityDataStatus(eligibility),
    hasUnresolvedEligibility,
    application: {
      officialUrl: raw.온라인신청사이트URL,
      applicationUrl: raw.온라인신청사이트URL,
      sourceUrl: raw.온라인신청사이트URL,
      startDate: deadline.startDate,
      endDate: deadline.endDate,
      deadlineType: deadline.deadlineType,
    },
    institution: { name: raw.소관기관명, type: "government" },
    requiredDocuments: splitDocumentList(raw.구비서류),
    updatedAt: raw.수정일시,
    isDemo: false,
  };
}

/** Builds an eligibility rule group from confirmed supportConditions fields only (currently: applicant age range). */
export function normalizeMOISSupportConditions(raw: MOISRawSupportCondition): EligibilityRuleGroup | undefined {
  const min = raw.JA0110;
  const max = raw.JA0111;
  if (typeof min === "number" && typeof max === "number") {
    return {
      type: "all",
      rules: [{ id: "mois-age", field: "age", operator: "between", value: [min, max], required: true }],
    };
  }
  return undefined;
}
