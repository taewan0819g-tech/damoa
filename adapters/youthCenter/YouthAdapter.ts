import type { Benefit, BenefitCategory, BenefitType, EligibilityRuleGroup, InstitutionType } from "@/types/benefit";

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

function buildEligibility(raw: YouthRawPolicy): EligibilityRuleGroup | undefined {
  if (raw.sprtTrgtAgeLmtYn !== "Y") return undefined;
  const min = raw.sprtTrgtMinAge ? Number(raw.sprtTrgtMinAge) : undefined;
  const max = raw.sprtTrgtMaxAge ? Number(raw.sprtTrgtMaxAge) : undefined;
  if (typeof min === "number" && typeof max === "number" && !Number.isNaN(min) && !Number.isNaN(max)) {
    return {
      type: "all",
      rules: [{ id: "youth-age", field: "age", operator: "between", value: [min, max], required: true }],
    };
  }
  return undefined;
}

export function normalizeYouthPolicy(raw: YouthRawPolicy): Benefit {
  const organization = raw.sprvsnInstCdNm || raw.operInstCdNm || "온통청년";
  return {
    id: `youth-${raw.plcyNo}`,
    title: raw.plcyNm,
    shortDescription: raw.plcyExplnCn || raw.plcySprtCn || raw.plcyNm,
    category: mapCategory(raw),
    source: { type: "youth_policy", organization, providerId: raw.plcyNo },
    benefitType: mapBenefitType(raw),
    eligibility: buildEligibility(raw),
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
