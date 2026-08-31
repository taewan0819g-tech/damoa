import type { Benefit, BenefitCategory, BenefitType, EligibilityRuleGroup, InstitutionType } from "@/types/benefit";

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

function mapCategory(raw: MOISRawServiceListItem | MOISRawServiceDetail): BenefitCategory {
  const field = "서비스분야" in raw ? raw.서비스분야 : undefined;
  const text = `${field ?? ""} ${raw.서비스명 ?? ""}`;
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (has("보육", "육아", "아동", "출산")) return "childcare";
  if (has("주거", "주택", "전세", "임대")) return "housing";
  if (has("교육", "학비", "장학")) return "education";
  if (has("고용", "취업", "일자리", "직업훈련")) return "employment";
  if (has("창업")) return "startup";
  if (has("가족", "한부모", "다문화")) return "family";
  if (has("교통")) return "transport";
  if (has("금융", "저축", "자산형성")) return "asset_building";
  return "welfare";
}

function mapBenefitType(지원유형?: string): BenefitType {
  const text = 지원유형 ?? "";
  if (text.includes("현금")) return "cash";
  if (text.includes("대출") || text.includes("융자")) return "loan";
  if (text.includes("이용권") || text.includes("바우처") || text.includes("서비스")) return "service";
  if (text.includes("현물")) return "discount";
  return "other";
}

function mapInstitutionType(소관기관유형?: string): InstitutionType {
  if (!소관기관유형) return "government";
  if (소관기관유형.includes("지자체") || 소관기관유형.includes("지방")) return "local_government";
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

export function normalizeMOISServiceListItem(raw: MOISRawServiceListItem): Benefit {
  return {
    id: `mois-${raw.서비스ID}`,
    title: raw.서비스명,
    shortDescription: raw.서비스목적요약 || raw.지원내용 || raw.서비스명,
    category: mapCategory(raw),
    source: { type: "government", organization: raw.소관기관명, providerId: raw.서비스ID },
    benefitType: mapBenefitType(raw.지원유형),
    application: {
      officialUrl: raw.상세조회URL,
      sourceUrl: raw.상세조회URL,
    },
    institution: { name: raw.소관기관명, type: mapInstitutionType(raw.소관기관유형) },
    tags: raw.서비스분야 ? [raw.서비스분야] : undefined,
    updatedAt: raw.수정일시 ?? raw.등록일시,
    isDemo: false,
  };
}

export function normalizeMOISServiceDetail(raw: MOISRawServiceDetail, eligibility?: EligibilityRuleGroup): Benefit {
  return {
    id: `mois-${raw.서비스ID}`,
    title: raw.서비스명,
    shortDescription: raw.서비스목적 || raw.지원내용 || raw.서비스명,
    category: mapCategory(raw),
    source: { type: "government", organization: raw.소관기관명, providerId: raw.서비스ID },
    benefitType: mapBenefitType(raw.지원유형),
    eligibility,
    application: {
      officialUrl: raw.온라인신청사이트URL,
      applicationUrl: raw.온라인신청사이트URL,
      sourceUrl: raw.온라인신청사이트URL,
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
