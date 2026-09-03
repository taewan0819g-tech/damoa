import type {
  Benefit,
  BenefitCategory,
  BenefitType,
  EligibilityRule,
  EligibilityRuleGroup,
  InstitutionType,
} from "@/types/benefit";
import {
  buildEducationStatusRule,
  buildEmploymentStatusRule,
  buildMaritalStatusRule,
} from "@/domain/youthCodebook/compatibility";

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
  /**
   * Marital status condition code (family 0055: 기혼/미혼/제한없음). See
   * domain/youthCodebook/ for the official code table and
   * domain/youthCodebook/compatibility.ts's `buildMaritalStatusRule` for the
   * production mapping onto Damoa's `maritalStatus` profile field.
   */
  mrgSttsCd?: string;
  /**
   * Employment status condition code(s) (family 0013), comma-delimited
   * OR/whitelist when multiple. See `buildEmploymentStatusRule`.
   */
  jobCd?: string;
  /**
   * Education status condition code(s) (family 0049), comma-delimited
   * OR/whitelist when multiple. See `buildEducationStatusRule`.
   */
  schoolCd?: string;
  /**
   * Target-group/business-status condition code(s) (family 0014),
   * comma-delimited OR/whitelist when multiple. No Damoa profile field maps
   * safely onto any specific code as of Phase 4-B (see
   * domain/youthCodebook/table.ts) — kept typed for documentation/future use
   * only; never wired into buildEligibility().
   */
  sbizCd?: string;
  /**
   * Academic-major condition code(s) (family 0011), comma-delimited
   * OR/whitelist when multiple. Damoa has no academic-major profile field —
   * kept typed for documentation/future use only; never wired into
   * buildEligibility().
   */
  plcyMajorCd?: string;
  /**
   * Region condition code(s), 5-digit 법정동코드(administrative-district
   * codes), comma-delimited when multiple. NOT present in the official
   * codebook XLSX (confirmed absent from all 4 sheets) — its raw values
   * were independently identified as 법정동코드 via an external public
   * cross-reference. Building a rule requires a 법정동코드 -> Damoa
   * region-text crosswalk that doesn't exist yet (see
   * domain/youthCodebook/compatibility.ts's `ZIP_CD_NEXT_STEP`); kept typed
   * for documentation/future use only, never wired into buildEligibility().
   */
  zipCd?: string;
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
 *
 * Official codebook labels (family 0043, see `domain/youthCodebook/table.ts`
 * / `domain/youthCodebook/provenance.ts` for the verified source): 0043001
 * = 무관 ("unrelated"/no condition), 0043002 = 연소득 ("annual income" —
 * the one structured variant handled below), 0043003 = 기타 ("other" —
 * confirmed via a 2,743-record cross-check against `earnEtcCn` to always be
 * free text and never a structured amount; see the Phase 4-A audit, §11).
 * This behavior is UNCHANGED from before Phase 4-B — only the provenance
 * reference was updated from an empirical pre-XLSX understanding to the
 * now-verified official codebook.
 */
// earnMinAmt/earnMaxAmt are denominated in 만원 (10,000 KRW) units — confirmed
// live: getPlcy?plcyNo=20260724005400113307 ("햇살론유스", a well-known
// program capped around 35,000,000 KRW annual income) returns
// earnMaxAmt: "3500", i.e. 3500만원 = 35,000,000 KRW.
//
// The user's real profile input is an income BAND (individualIncomeBand),
// never an exact figure, and `resolveProfileField` turns that band into a
// `{min, max}` range via `individualIncomeRange`. So this rule must compare
// RANGE vs RANGE (`range_within`) against that virtual field, not a scalar
// vs the legacy `annualIndividualIncome` field — nothing in the current UI
// ever writes that scalar (see OnboardingFlow.tsx / profile/page.tsx, both
// collect only income bands), so a `field: "annualIndividualIncome"` rule
// would silently never resolve for any real user and every Youth Center
// income condition would be dead on arrival. `individualIncomeRange` still
// falls back to the legacy scalar as a degenerate {min: x, max: x} range
// for any caller that does set it, so backward compatibility is preserved.
const MANWON_TO_KRW = 10000;

function buildIncomeRule(raw: YouthRawPolicy): EligibilityRule | undefined {
  if (raw.earnCndSeCd !== "0043002") return undefined;
  const min = raw.earnMinAmt ? Number(raw.earnMinAmt) : undefined;
  const max = raw.earnMaxAmt ? Number(raw.earnMaxAmt) : undefined;
  const hasMin = typeof min === "number" && !Number.isNaN(min) && min > 0;
  const hasMax = typeof max === "number" && !Number.isNaN(max) && max > 0;

  if (hasMin && hasMax) {
    return {
      id: "youth-income",
      field: "individualIncomeRange",
      operator: "range_within",
      value: [min * MANWON_TO_KRW, max * MANWON_TO_KRW],
      required: true,
    };
  }
  if (hasMax) {
    return {
      id: "youth-income-max",
      field: "individualIncomeRange",
      operator: "range_within",
      value: [0, max * MANWON_TO_KRW],
      required: true,
    };
  }
  if (hasMin) {
    return {
      id: "youth-income-min",
      field: "individualIncomeRange",
      operator: "range_within",
      value: [min * MANWON_TO_KRW, Number.POSITIVE_INFINITY],
      required: true,
    };
  }
  return undefined;
}

function buildEligibility(raw: YouthRawPolicy): EligibilityRuleGroup | undefined {
  const rules = [
    buildAgeRule(raw),
    buildIncomeRule(raw),
    buildMaritalStatusRule(raw.mrgSttsCd),
    buildEmploymentStatusRule(raw.jobCd),
    buildEducationStatusRule(raw.schoolCd),
  ].filter((r): r is EligibilityRule => Boolean(r));
  if (rules.length === 0) return undefined;
  return { type: "all", rules };
}

/**
 * Eligibility completeness for Youth Center records.
 *
 * Phase 4-B added production rule-building for `mrgSttsCd` (marital
 * status), `jobCd` (employment status), and `schoolCd` (education status)
 * on top of the existing age/income rules — see
 * `domain/youthCodebook/compatibility.ts`'s `buildMaritalStatusRule` /
 * `buildEmploymentStatusRule` / `buildEducationStatusRule`, keyed off the
 * official 온통청년 코드정의서 (API코드정보.xlsx — see
 * `domain/youthCodebook/provenance.ts` and the Phase 4-A audit at
 * docs/youth-codebook-phase4-audit.md for full source provenance and the
 * Phase 4-B corrections applied on top of that audit's initial proposals).
 * Every live record also carries `sbizCd` (business/target-group status),
 * `zipCd` (residence area), and `plcyMajorCd` (academic major) — NONE of
 * those are wired into rule-building this phase: `sbizCd`'s specific codes
 * are either scope-mismatched against existing profile fields (e.g.
 * 한부모가정 vs. the family-membership-scoped `singleParentFamily`) or have
 * no matching Damoa concept at all; `plcyMajorCd` has no Damoa academic-major
 * field; `zipCd` isn't even in the official codebook and would need a
 * separate 법정동코드 crosswalk (see `compatibility.ts`'s `ZIP_CD_NEXT_STEP`).
 * See `domain/youthCodebook/table.ts` for the exact per-code
 * `implementationStatus` driving every one of these decisions.
 *
 * So even with marital/employment/education now structured, ANY built
 * eligibility group is STILL marked "incomplete" — unconditionally,
 * regardless of which specific rules it contains. We know there's real
 * business-status/region/major eligibility data on every record that we
 * still don't structure, so a full pass on the rules we DO parse is never
 * strong enough evidence for likely_eligible on its own (see
 * `lib/eligibility/ruleEngine.ts`'s `evaluateEligibilityDetailed`, which
 * downgrades a full pass on `"incomplete"` data to "unknown" rather than
 * promoting it — this is what keeps adding marital/employment/education
 * rules from ever increasing `likelyEligibleCount` by itself, only
 * improving candidate pruning and positive-evidence signal).
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
