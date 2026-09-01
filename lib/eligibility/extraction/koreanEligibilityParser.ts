import type { EligibilityRule } from "@/types/benefit";
import { normalizeProvince, PROVINCE_ALIAS_KEYS, type RegionSpec } from "../region";
import { intervalFromBoundaryWord } from "../interval";
import { EMPLOYMENT_TARGET_SPECS } from "../employment";

/**
 * Deterministic Korean eligibility text parser.
 *
 * Turns official free-text eligibility fields (지원대상, 선정기준, and
 * equivalents) into structured `EligibilityRule`s — WITHOUT an LLM, and
 * WITHOUT guessing. Every rule this module produces carries `evidence`
 * pointing back at the exact source text it came from.
 *
 * Scope is deliberately narrow: only high-confidence, unambiguous patterns
 * are converted. Anything that doesn't match a known pattern, or that
 * matches but is entangled with a negation/logic structure we can't safely
 * resolve, is reported in `unresolvedClauses` instead of being silently
 * dropped — that's what drives `hasUnresolvedEligibility` upstream (see
 * ruleEngine.ts), so "we couldn't parse this" never quietly becomes "there
 * was nothing to parse".
 */

export interface ExtractionResult {
  rules: EligibilityRule[];
  unresolvedClauses: string[];
}

// ---------------------------------------------------------------------------
// Text normalization (section 14): harmless linguistic variation only.
// Operator words (이상/초과/이하/미만) are NEVER touched — only whitespace,
// punctuation, and separator characters are normalized.
// ---------------------------------------------------------------------------
function normalizeText(input: string): string {
  return input
    .replace(/[\r\t]/g, " ")
    .replace(/[∼～]/g, "~")
    .replace(/[ㅡ―—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function withEvidence(rule: EligibilityRule, sourceField: string, sourceText: string): EligibilityRule {
  return { ...rule, evidence: { sourceField, sourceText, extractionType: "deterministic_text" } };
}

// ---------------------------------------------------------------------------
// Section 17: negation / exclusion safety.
// ---------------------------------------------------------------------------
const NEGATION_SUFFIXES = ["하지 않는", "하지 않은", "지 않는", "지 않은", "아닌", "않은"];

/** True if a negation marker immediately follows the match (within a short window). */
function isNegatedAfter(text: string, endIndex: number, window = 8): boolean {
  const after = text.slice(endIndex, endIndex + window);
  return NEGATION_SUFFIXES.some((s) => after.startsWith(s));
}

/**
 * Flips an inequality boundary word under negation — this is exact logical
 * negation of an inequality, not a guess: "이상하지 않은" (not >= X) means
 * "< X" (미만); "이하를 초과하지 않는" collapses to 이하 itself, etc.
 */
const BOUNDARY_FLIP: Record<string, string> = {
  "이상": "미만",
  "미만": "이상",
  "이하": "초과",
  "초과": "이하",
};

// ---------------------------------------------------------------------------
// AGE (sections 14, 15, 35)
// ---------------------------------------------------------------------------
function parseAgeClause(text: string): EligibilityRule | undefined {
  // "만? X세 이상 Y세 이하" (also accepts 초과/미만 on either bound)
  const rangeRe = /만?\s*(\d{1,3})\s*세\s*(이상|초과)\s*(\d{1,3})\s*세\s*(이하|미만)/;
  const rangeMatch = text.match(rangeRe);
  if (rangeMatch) {
    const [, minStr, minWord, maxStr, maxWord] = rangeMatch;
    const min = Number(minStr) + (minWord === "초과" ? 1 : 0);
    const max = Number(maxStr) - (maxWord === "미만" ? 1 : 0);
    return { id: "text-age-range", field: "age", operator: "between", value: [min, max], required: true };
  }

  // "만? X~Y세" tilde range (inclusive by convention)
  const tildeRe = /만?\s*(\d{1,3})\s*(?:세)?\s*~\s*(\d{1,3})\s*세/;
  const tildeMatch = text.match(tildeRe);
  if (tildeMatch) {
    const [, minStr, maxStr] = tildeMatch;
    return {
      id: "text-age-tilde",
      field: "age",
      operator: "between",
      value: [Number(minStr), Number(maxStr)],
      required: true,
    };
  }

  // Single-sided: "만? X세 (이상|초과|이하|미만)"
  const singleRe = /만?\s*(\d{1,3})\s*세\s*(이상|초과|이하|미만)/g;
  const single = singleRe.exec(text);
  if (single) {
    const [, ageStr, word] = single;
    const age = Number(ageStr);
    const negated = isNegatedAfter(text, single.index + single[0].length);
    const effectiveWord = negated ? BOUNDARY_FLIP[word] : word;
    switch (effectiveWord) {
      case "이상":
        return { id: "text-age-min", field: "age", operator: "gte", value: age, required: true };
      case "초과":
        return { id: "text-age-min-strict", field: "age", operator: "gt", value: age, required: true };
      case "이하":
        return { id: "text-age-max", field: "age", operator: "lte", value: age, required: true };
      case "미만":
        return { id: "text-age-max-strict", field: "age", operator: "lt", value: age, required: true };
      default:
        return undefined;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// INCOME (sections 8, 14, 15, 35): individual vs household, Korean numerals.
// ---------------------------------------------------------------------------

/** Parses a 만원-denominated amount written as "3,500", "6000", or Korean digit-units like "3천5백". */
function parseManwonNumber(raw: string): number | undefined {
  const cleaned = raw.trim();
  if (/^[\d,]+$/.test(cleaned)) {
    const n = Number(cleaned.replace(/,/g, ""));
    return Number.isNaN(n) ? undefined : n;
  }
  const m = cleaned.match(/^(?:(\d+)천)?(?:(\d+)백)?(?:(\d+)십)?(?:(\d+))?$/);
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    const 천 = m[1] ? Number(m[1]) * 1000 : 0;
    const 백 = m[2] ? Number(m[2]) * 100 : 0;
    const 십 = m[3] ? Number(m[3]) * 10 : 0;
    const 일 = m[4] ? Number(m[4]) : 0;
    return 천 + 백 + 십 + 일;
  }
  return undefined;
}

const MANWON_TO_KRW = 10000;

/**
 * "중위소득" (median-income-percentage) thresholds are intentionally NOT
 * parsed here (section 8): computing them correctly requires a known
 * householdSize, a known applicable year, and an official median-income
 * table — none of which this deterministic text parser has access to.
 * Detecting the phrase is still useful: it tells the caller there IS a real
 * income-eligibility clause, just one we can't safely resolve, so it's
 * reported as unresolved rather than silently dropped.
 */
const MEDIAN_INCOME_RE = /기준\s*중위소득/;

function parseIncomeClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  if (MEDIAN_INCOME_RE.test(text)) {
    return { unresolved: text };
  }

  const incomeRe = /(개인|가구)?\s*연\s?소득[^0-9]{0,4}([0-9,천백십]+)\s*만\s?원[^가-힣]{0,2}(이상|초과|이하|미만)/;
  const match = text.match(incomeRe);
  if (!match) return undefined;

  const [full, qualifier, amountStr, word] = match;
  const amount = parseManwonNumber(amountStr);
  if (amount === undefined) return { unresolved: text };

  const matchIndex = text.indexOf(full);
  const negated = isNegatedAfter(text, matchIndex + full.length);
  const effectiveWord = negated ? BOUNDARY_FLIP[word] : word;

  // Bare "연소득" with no explicit qualifier defaults to the applicant's own
  // (individual) income — the conventional reading for youth/individual
  // benefit text; an explicit "가구" prefix is required to mean household.
  const field = qualifier === "가구" ? "householdIncomeRange" : "individualIncomeRange";
  const krw = amount * MANWON_TO_KRW;

  // Preserves the 이상(>=)/초과(>)/이하(<=)/미만(<) boundary-inclusivity
  // distinction via Interval instead of collapsing it into a plain tuple —
  // see lib/eligibility/interval.ts.
  const interval = intervalFromBoundaryWord(effectiveWord as "이상" | "초과" | "이하" | "미만", krw);

  return {
    rule: { id: "text-income", field, operator: "range_within_interval", value: interval, required: true },
  };
}

// ---------------------------------------------------------------------------
// REGION (sections 9, 10, 33, 35)
// ---------------------------------------------------------------------------
const RESIDENCE_KEYWORDS = ["거주", "주민등록"];
const CITY_TOKEN_RE = /[가-힣]{2,6}(시|군|구)/;

// Longest-first so "서울특별시" matches before a shorter alias would.
const PROVINCE_NAMES_DESC = [...PROVINCE_ALIAS_KEYS].sort((a, b) => b.length - a.length);

function findProvinceMention(text: string): { alias: string; index: number } | undefined {
  for (const name of PROVINCE_NAMES_DESC) {
    const idx = text.indexOf(name);
    if (idx !== -1) return { alias: name, index: idx };
  }
  return undefined;
}

function parseRegionClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  if (!RESIDENCE_KEYWORDS.some((k) => text.includes(k))) return undefined;

  const provinceMention = findProvinceMention(text);
  if (!provinceMention) {
    // A lone city/county/district name with no province context: real, but
    // we don't maintain a city->province gazetteer (verified unreliable —
    // see MOIS/Youth field audit notes), so this is left unresolved rather
    // than guessed.
    if (CITY_TOKEN_RE.test(text)) return { unresolved: text };
    return undefined;
  }

  const province = normalizeProvince(provinceMention.alias);
  if (!province) return undefined;

  const after = text.slice(
    provinceMention.index + provinceMention.alias.length,
    provinceMention.index + provinceMention.alias.length + 12
  );
  const cityMatch = after.match(CITY_TOKEN_RE);
  const spec: RegionSpec = cityMatch ? { province, city: cityMatch[0] } : { province };

  return {
    rule: { id: "text-region", field: "residence", operator: "region_in", value: [spec], required: true },
  };
}

// ---------------------------------------------------------------------------
// EDUCATION / TARGET hierarchy (sections 6, 12, 35, 36)
// ---------------------------------------------------------------------------
function parseEducationClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const negatedNear = (keyword: string) => {
    const idx = text.indexOf(keyword);
    return idx !== -1 && (text.slice(Math.max(0, idx - 6), idx).includes("제외") || text.slice(idx, idx + keyword.length + 6).includes("제외"));
  };

  if (/대학생\s*(또는|혹은)\s*대학원생|대학원생\s*(또는|혹은)\s*대학생/.test(text)) {
    if (negatedNear("대학생")) return { unresolved: text };
    return {
      rule: {
        id: "text-education-univ-grad",
        field: "educationStatus",
        operator: "in",
        value: ["university", "graduate_school"],
        required: true,
      },
    };
  }

  if (text.includes("대학원생")) {
    if (negatedNear("대학원생")) return { unresolved: text };
    return { rule: { id: "text-education-grad", field: "educationStatus", operator: "eq", value: "graduate_school", required: true } };
  }

  if (text.includes("대학생")) {
    if (negatedNear("대학생")) return { unresolved: text };
    return { rule: { id: "text-education-univ", field: "educationStatus", operator: "eq", value: "university", required: true } };
  }

  if (text.includes("고등학생")) {
    if (negatedNear("고등학생")) return { unresolved: text };
    return { rule: { id: "text-education-high", field: "educationStatus", operator: "eq", value: "high_school", required: true } };
  }

  // Bare "학생" (broad, hierarchical umbrella over high_school/university/graduate_school)
  if (/(?<!대)(?<!대학)학생/.test(text) || text.includes("학생")) {
    if (negatedNear("학생")) return { unresolved: text };
    return {
      rule: {
        id: "text-education-student",
        field: "educationStatus",
        operator: "in",
        value: ["high_school", "university", "graduate_school"],
        required: true,
      },
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// EMPLOYMENT (sections 12, 35, 36)
// ---------------------------------------------------------------------------
function parseEmploymentClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const negatedNear = (keyword: string) => {
    const idx = text.indexOf(keyword);
    return idx !== -1 && text.slice(Math.max(0, idx - 6), idx + keyword.length + 6).includes("제외");
  };

  if (text.includes("미취업")) {
    if (negatedNear("미취업")) return { unresolved: text };
    return {
      rule: {
        id: "text-employment-unemployed",
        field: "employmentStatus",
        operator: "status_compat",
        value: EMPLOYMENT_TARGET_SPECS.unemployed,
        required: true,
      },
    };
  }
  if (text.includes("재직")) {
    if (negatedNear("재직")) return { unresolved: text };
    return {
      rule: {
        id: "text-employment-employed",
        field: "employmentStatus",
        operator: "status_compat",
        value: EMPLOYMENT_TARGET_SPECS.employed,
        required: true,
      },
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// HOUSING (sections 12, 17, 35)
// ---------------------------------------------------------------------------
function parseHousingClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  if (text.includes("무주택")) {
    return {
      rule: { id: "text-housing-nonowner", field: "homeowner", operator: "eq", value: false, required: true },
    };
  }
  const ownerIdx = text.indexOf("주택 보유자");
  const ownerIdx2 = text.indexOf("주택보유자");
  const idx = ownerIdx !== -1 ? ownerIdx : ownerIdx2;
  if (idx !== -1) {
    const nearby = text.slice(idx, idx + 20);
    if (nearby.includes("제외")) {
      return {
        rule: { id: "text-housing-nonowner-excl", field: "homeowner", operator: "eq", value: false, required: true },
      };
    }
    // A "주택 보유자" mention without a nearby "제외" is real eligibility text
    // (e.g. an owner-only requirement, or a permissive "owners are also
    // allowed" carve-out) but the two readings resolve to opposite rules —
    // required (homeowner: true) vs merely permitted (no rule at all) — and
    // we can't safely distinguish them from this substring alone. Report as
    // unresolved instead of silently dropping a real clause.
    return { unresolved: text };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// BUSINESS OWNERSHIP (sections 12, 17, 35)
// ---------------------------------------------------------------------------
function parseBusinessClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const idx = text.indexOf("사업자등록");
  if (idx === -1) return undefined;
  const after = text.slice(idx, idx + 20);
  if (after.includes("없는") || after.includes("없다") || after.includes("하지 않은")) {
    return {
      rule: { id: "text-business-none", field: "businessOwner", operator: "eq", value: false, required: true },
    };
  }
  if (after.includes("있는") || after.includes("보유한") || after.includes("한 자")) {
    return {
      rule: { id: "text-business-owner", field: "businessOwner", operator: "eq", value: true, required: true },
    };
  }
  // "사업자등록" is mentioned but not in one of the two unambiguous phrasings
  // above — a real clause we can't safely resolve, so it's reported rather
  // than dropped.
  return { unresolved: text };
}

// ---------------------------------------------------------------------------
// CHILDREN COUNT (sections 12, 35)
// ---------------------------------------------------------------------------
function parseChildrenClause(text: string): EligibilityRule | undefined {
  const match = text.match(/자녀\s*(\d+)\s*명\s*이상/);
  if (!match) return undefined;
  return { id: "text-children-gte", field: "childrenCount", operator: "gte", value: Number(match[1]), required: true };
}

// ---------------------------------------------------------------------------
// Boolean logic classification (section 16, 35) — standalone utility, also
// used to guard against mis-AND-ing an explicitly-OR'd clause (see below).
// ---------------------------------------------------------------------------
export type LogicalConnective = "all" | "any" | "unresolved";

const AND_SIGNALS = ["모두 충족", "다음 각 호를 모두", "이면서", " 및 "];
const OR_SIGNALS = ["또는", "혹은", "다음 중", "어느 하나"];

export function detectLogicalConnective(text: string): LogicalConnective {
  const hasAnd = AND_SIGNALS.some((s) => text.includes(s));
  const hasOr = OR_SIGNALS.some((s) => text.includes(s));
  if (hasAnd && !hasOr) return "all";
  if (hasOr && !hasAnd) return "any";
  return "unresolved";
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------
export function extractEligibilityFromText(sourceField: string, rawText: string | undefined | null): ExtractionResult {
  if (!rawText || !rawText.trim()) return { rules: [], unresolvedClauses: [] };
  const text = normalizeText(rawText);

  const rules: EligibilityRule[] = [];
  const unresolvedClauses: string[] = [];

  const age = parseAgeClause(text);
  if (age) rules.push(withEvidence(age, sourceField, text));

  const income = parseIncomeClause(text);
  if (income?.rule) rules.push(withEvidence(income.rule, sourceField, text));
  else if (income?.unresolved) unresolvedClauses.push(income.unresolved);

  const region = parseRegionClause(text);
  if (region?.rule) rules.push(withEvidence(region.rule, sourceField, text));
  else if (region?.unresolved) unresolvedClauses.push(region.unresolved);

  const education = parseEducationClause(text);
  if (education?.rule) rules.push(withEvidence(education.rule, sourceField, text));
  else if (education?.unresolved) unresolvedClauses.push(education.unresolved);

  const employment = parseEmploymentClause(text);
  if (employment?.rule) rules.push(withEvidence(employment.rule, sourceField, text));
  else if (employment?.unresolved) unresolvedClauses.push(employment.unresolved);

  const housing = parseHousingClause(text);
  if (housing?.rule) rules.push(withEvidence(housing.rule, sourceField, text));
  else if (housing?.unresolved) unresolvedClauses.push(housing.unresolved);

  const business = parseBusinessClause(text);
  if (business?.rule) rules.push(withEvidence(business.rule, sourceField, text));
  else if (business?.unresolved) unresolvedClauses.push(business.unresolved);

  const children = parseChildrenClause(text);
  if (children) rules.push(withEvidence(children, sourceField, text));

  // Safety net (section 16): if the clause explicitly reads as an OR across
  // multiple independent dimensions, don't silently AND our independently-
  // extracted rules together — that could turn "A 또는 B" into a
  // (wrong, stricter) "A AND B". Bail out to unresolved instead.
  if (rules.length >= 2 && detectLogicalConnective(text) === "any") {
    unresolvedClauses.push(text);
    return { rules: [], unresolvedClauses };
  }

  return { rules, unresolvedClauses };
}
