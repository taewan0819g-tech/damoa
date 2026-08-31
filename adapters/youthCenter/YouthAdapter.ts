import type {
  Benefit,
  BenefitCategory,
  BenefitType,
  EligibilityRule,
  EligibilityRuleGroup,
  InstitutionType,
} from "@/types/benefit";

/**
 * Raw record shape confirmed live against the 온통청년(Youth Center) Open API
 * on 2026-08-31 using a real service key:
 *   GET https://www.youthcenter.go.kr/go/ythip/getPlcy
 *     ?apiKeyNm=<key>&pageNum=&pageSize=&pageType=1&rtnType=json[&plcyNo=<id>]
 *
 * (The endpoint documented on the site's own oaiDoc page,
 * youthcenter.go.kr/opi/youthPlcyList.do, is dead — it 302-redirects to an
 * unreachable internal host. This `go/ythip/getPlcy` endpoint is the one
 * that actually works.) Field names below are the real keys returned by the
 * live API, not guessed.
 */
export interface YouthRawPolicy {
  plcyNo: string;
  plcyNm: string;
  plcyExplnCn?: string;
  plcyKywdNm?: string | null;
  lclsfNm?: string | null;
  mclsfNm?: string | null;
  plcySprtCn?: string;
  sprvsnInstCdNm?: string;
  operInstCdNm?: string;
  bizPrdBgngYmd?: string;
  bizPrdEndYmd?: string;
  bizPrdEtcCn?: string;
  plcyAplyMthdCn?: string;
  aplyUrlAddr?: string;
  sbmsnDcmntCn?: string;
  refUrlAddr1?: string;
  refUrlAddr2?: string;
  sprtTrgtMinAge?: string;
  sprtTrgtMaxAge?: string;
  sprtTrgtAgeLmtYn?: string;
  aplyYmd?: string;
  frstRegDt?: string;
  lastMdfcnDt?: string;
  /**
   * Income condition type code. Confirmed via a 500-record correlation
   * analysis against `earnMinAmt`/`earnMaxAmt`/`earnEtcCn`:
   *   "0043001" = no income condition
   *   "0043002" = structured min/max income amount (KRW, annual) — the only
   *               variant we can safely turn into a rule
   *   "0043003" = free-text income description only (`earnEtcCn`) — not
   *               structured, left as unstructured/unknown
   */
  earnCndSeCd?: string;
  earnMinAmt?: string;
  earnMaxAmt?: string;
  earnEtcCn?: string;
  [key: string]: unknown;
}

function mapCategory(raw: YouthRawPolicy): BenefitCategory {
  const text = `${raw.lclsfNm ?? ""} ${raw.mclsfNm ?? ""} ${raw.plcyNm}`;
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (has("주거")) return "housing";
  if (has("보육", "육아", "출산")) return "childcare";
  if (has("교육", "직업훈련", "학비", "장학")) return "education";
  if (has("일자리", "고용", "취업", "인턴")) return "employment";
  if (has("창업")) return "startup";
  if (has("가족", "한부모")) return "family";
  if (has("교통")) return "transport";
  if (has("금융", "자산형성", "저축")) return "asset_building";
  return "welfare";
}

function mapBenefitType(raw: YouthRawPolicy): BenefitType {
  const text = `${raw.plcyKywdNm ?? ""} ${raw.mclsfNm ?? ""}`;
  if (text.includes("보조금") || text.includes("현금")) return "cash";
  if (text.includes("대출") || text.includes("융자")) return "loan";
  if (text.includes("교육") || text.includes("서비스") || text.includes("바우처")) return "service";
  return "other";
}

function mapInstitutionType(name?: string): InstitutionType {
  if (!name) return "local_government";
  if (/(특별시|광역시|도청|^\S+시$|^\S+군$|^\S+구$)/.test(name)) return "local_government";
  if (/(부|처|청|공단|공사|원)$/.test(name)) return "government";
  return "local_government";
}

function splitList(text?: string): string[] | undefined {
  if (!text) return undefined;
  const items = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*·○\s]+/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function buildAgeRule(raw: YouthRawPolicy): EligibilityRule | undefined {
  if (raw.sprtTrgtAgeLmtYn !== "Y") return undefined;
  const min = raw.sprtTrgtMinAge ? Number(raw.sprtTrgtMinAge) : undefined;
  const max = raw.sprtTrgtMaxAge ? Number(raw.sprtTrgtMaxAge) : undefined;
  if (typeof min === "number" && typeof max === "number" && !Number.isNaN(min) && !Number.isNaN(max)) {
    return { id: "youth-age", field: "age", operator: "between", value: [min, max], required: true };
  }
  return undefined;
}

/**
 * Only `earnCndSeCd === "0043002"` (structured min/max income amount) is
 * turned into a rule. "0043001" (no condition) needs no rule, and
 * "0043003" (free-text description only, in `earnEtcCn`) can't be
 * structured without guessing at natural-language content, so it's left
 * unstructured — the benefit falls back to "unknown" for that criterion
 * rather than a false "likely_eligible" or "not_eligible".
 */
// earnMinAmt/earnMaxAmt are denominated in 만원 (10,000 KRW) units — confirmed
// live: getPlcy?plcyNo=20260724005400113307 ("햇살론유스", a well-known
// program capped around 35,000,000 KRW annual income) returns
// earnMaxAmt: "3500", i.e. 3500만원 = 35,000,000 KRW. The profile's
// `annualIndividualIncome` field is raw KRW (see OnboardingFlow.tsx, which
// multiplies the user's 만원 input by 10,000 before storing it), so these
// amounts must be converted to raw KRW to compare correctly.
const MANWON_TO_KRW = 10000;

function buildIncomeRule(raw: YouthRawPolicy): EligibilityRule | undefined {
  if (raw.earnCndSeCd !== "0043002") return undefined;
  const min = raw.earnMinAmt ? Number(raw.earnMinAmt) : undefined;
  const max = raw.earnMaxAmt ? Number(raw.earnMaxAmt) : undefined;
  if (typeof min === "number" && typeof max === "number" && !Number.isNaN(min) && !Number.isNaN(max)) {
    return {
      id: "youth-income",
      field: "annualIndividualIncome",
      operator: "between",
      value: [min * MANWON_TO_KRW, max * MANWON_TO_KRW],
      required: true,
    };
  }
  if (typeof max === "number" && !Number.isNaN(max)) {
    return {
      id: "youth-income-max",
      field: "annualIndividualIncome",
      operator: "lte",
      value: max * MANWON_TO_KRW,
      required: true,
    };
  }
  if (typeof min === "number" && !Number.isNaN(min)) {
    return {
      id: "youth-income-min",
      field: "annualIndividualIncome",
      operator: "gte",
      value: min * MANWON_TO_KRW,
      required: true,
    };
  }
  return undefined;
}

function buildEligibility(raw: YouthRawPolicy): EligibilityRuleGroup | undefined {
  const rules = [buildAgeRule(raw), buildIncomeRule(raw)].filter((r): r is EligibilityRule => Boolean(r));
  if (rules.length === 0) return undefined;
  return { type: "all", rules };
}

/**
 * Eligibility completeness for Youth Center records.
 *
 * We only structure age (`sprtTrgt*Age*`) and individual income
 * (`earnCndSeCd === "0043002"`). But every live record also carries
 * `mrgSttsCd` (marital status), `jobCd` (employment status), `schoolCd`
 * (education status), `sbizCd` (business/startup status), `zipCd`
 * (residence area) and `plcyMajorCd` — confirmed live via a 300-record
 * sample (see this file's test + `adapters/youthCenter/YouthAdapter.ts`
 * history) to always carry a non-blank value. A handful of specific codes
 * appear alongside one dominant value per field (e.g. jobCd is "0013010"
 * ~76% of the time, with ~10 other specific codes filling the rest), which
 * is consistent with the dominant value meaning "제한없음"(no restriction)
 * and the others meaning a real, specific restriction — but 온통청년 doesn't
 * publish a code table to confirm that mapping, and guessing it wrong
 * would risk turning a real restriction into a false pass. So none of
 * those fields are structured into rules, and ANY built eligibility group
 * (age and/or income) is marked "incomplete": we know there's more region/
 * employment/education/marital/business eligibility data on every record
 * than we can safely parse, so a pass on age+income alone is never strong
 * enough evidence for likely_eligible.
 */
function eligibilityDataStatus(eligibility: EligibilityRuleGroup | undefined): Benefit["eligibilityDataStatus"] {
  return eligibility ? "incomplete" : undefined;
}

export function normalizeYouthPolicy(raw: YouthRawPolicy): Benefit {
  const organization = raw.sprvsnInstCdNm || raw.operInstCdNm || "온통청년";
  const eligibility = buildEligibility(raw);
  return {
    id: `youth-${raw.plcyNo}`,
    title: raw.plcyNm,
    shortDescription: raw.plcyExplnCn || raw.plcySprtCn || raw.plcyNm,
    category: mapCategory(raw),
    source: { type: "youth_policy", organization, providerId: raw.plcyNo },
    benefitType: mapBenefitType(raw),
    eligibility,
    eligibilityDataStatus: eligibilityDataStatus(eligibility),
    application: {
      startDate: raw.bizPrdBgngYmd?.trim() || undefined,
      endDate: raw.bizPrdEndYmd?.trim() || undefined,
      officialUrl: raw.refUrlAddr1 || raw.aplyUrlAddr,
      applicationUrl: raw.aplyUrlAddr,
      sourceUrl: raw.refUrlAddr1 || raw.aplyUrlAddr,
    },
    institution: { name: organization, type: mapInstitutionType(organization) },
    requiredDocuments: splitList(raw.sbmsnDcmntCn),
    tags: [raw.lclsfNm, raw.mclsfNm].filter((v): v is string => Boolean(v)),
    updatedAt: raw.lastMdfcnDt || raw.frstRegDt,
    isDemo: false,
  };
}
