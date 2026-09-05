import type { EligibilityRule } from "@/types/benefit";
import { normalizeProvince, PROVINCE_ALIAS_KEYS, type RegionSpec } from "../region";
import { resolveCityProvinces, getShortDistrictNames, getCitiesForProvince } from "../regionGazetteer";
import { intervalFromBoundaryWord } from "../interval";
import { EMPLOYMENT_TARGET_SPECS } from "../employment";
import type { MarriageDurationBoundary, MarriageDurationSpec } from "@/domain/profile/marriageDuration";
import type { MedianIncomeBoundary, MedianIncomeThresholdSpec } from "@/domain/medianIncome/evaluate";

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
 * "중위소득" (median-income-percentage) thresholds require a known
 * householdSize, a known applicable year, and an official median-income
 * table to actually resolve to pass/fail — none of which this deterministic
 * TEXT parser has access to, so this parser only ever extracts the SHAPE
 * (percent + boundary + household-size-mode + optional explicit year) into a
 * `median_income_threshold` rule; the actual lookup/comparison happens at
 * evaluation time (see domain/medianIncome/evaluate.ts).
 *
 * Checkpoint-5 (external-review correction): a rule is emitted ONLY when
 * ALL THREE hold: (a) a percent + Korean boundary word is parsed near the
 * anchor (`MEDIAN_INCOME_PERCENT_RE`); (b) NONE of the known disqualifiers
 * match nearby — a different metric entirely (소득인정액/건강보험료·건보료),
 * individual-not-household income (개인소득/본인 소득/종합소득, or the
 * adjacency-scoped "본인" label), an explicit per-household-size table
 * marker ("가구원 수에 따라"/"가구 규모별"), the applicant's own wage/earned
 * income (임금/근로소득/개인·근로자 월평균소득), or the applicant+spouse's
 * COMBINED-but-not-household income (부부합산(연)?소득 등); AND (c) an
 * EXPLICIT positive household-income label is found nearby
 * (`MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE` — 가구소득/가구원소득/세대소득
 * and siblings, or an explicitly household-framed anchor like "가구단위
 * 중위소득"). (c) is the core fix here: the old logic treated "no known
 * disqualifier matched" as sufficient to assume household income, which is
 * backwards — absence of a blacklist hit never proves the compared figure is
 * actually household-scoped. An empirical frozen-snapshot survey of every
 * real 중위소득 anchor hit (881 total, see
 * scripts/_tmpPositiveSignalSurvey.ts) found 774/881 (~88%) carry NEITHER a
 * positive household-income signal NOR a known disqualifier — just a bare
 * "기준중위소득 N% 이하" with zero scoping wording — so requiring an explicit
 * positive signal is not a marginal tightening, it is the difference between
 * this parser being mostly right and mostly guessing.
 *
 * ANY "중위소득" mention (기준-prefixed or bare) that fails any of (a)/(b)/(c),
 * or that has ANY nearby household-size number (even a single one — a real
 * MOIS gold review found a lone nearby size is not a safe
 * `fixed_reference_household` signal either way, see
 * `parseMedianIncomeClause`), still falls back to unresolved rather than
 * being silently dropped — false negatives are acceptable here, false
 * positives are not.
 */
const MEDIAN_INCOME_RE = /(?:기준\s*)?중위\s*소득/;

/**
 * A percent number + Korean boundary word anchored near a "중위소득"
 * mention, e.g. "기준중위소득 50% 이하", "기준 중위소득의 60%이하", "기준중위소득
 * 대비 100% 이하", or bare "중위소득 60% 이하인 자" / "중위소득 120% 미만"
 * (real MOIS text frequently drops the "기준" prefix — a frozen-snapshot
 * audit found 203 of 881 총 중위소득 mentions are bare; the "기준" prefix is
 * therefore OPTIONAL here, matching `MEDIAN_INCOME_RE` and the audit
 * script's `ANCHOR_RE`, so these clauses are no longer silently invisible
 * to this parser — see 서비스ID 383000000146, 135200000102). The bounded,
 * non-greedy gap between the anchor and the digit run allows short
 * connective words (의/대비/공백) without risking a match against an
 * unrelated LATER percent elsewhere in a long paragraph.
 */
const MEDIAN_INCOME_PERCENT_RE = /(?:기준\s*)?중위\s*소득[^\n]{0,12}?(\d{1,3})\s*%\s*(이상|초과|이하|미만)/;

/**
 * Deliberately NOT supported: Korean fraction notation ("100분의 50", "2분의
 * 1") as an alternative to a literal "%" sign. A real-MOIS review of every
 * frozen-snapshot 기준중위소득 fraction-notation clause (12 total) found the
 * majority reference a DIFFERENT, disqualifying metric that the nearby text
 * only reveals via wording this regex-based disqualifier check can miss at a
 * glance — e.g. "소득 인정액이 기준 중위소득의 100분의 50 이하" (서비스ID
 * 134200000003) and "...소득인 정액이 기준 중위소득의 100분의 50이하..." (서비스ID
 * 643000000730) are 소득인정액 clauses with irregular internal spacing, and
 * "직전 연도 기준 중위소득의 100분의 40 이상" (서비스ID 999000000027) qualifies
 * "종합소득금액" (an individual tax-return income figure), not household
 * income. Adding fraction-notation extraction on top of an already
 * higher-risk sample would meaningfully raise the odds of a false-positive
 * household_income rule. The metric-disqualifier check above was widened to
 * be whitespace-tolerant specifically because of these examples, but
 * fraction notation itself stays unresolved rather than extracted — see
 * scripts/auditMedianIncomeEligibilityFrozen.ts, which reports fraction-form
 * hits SEPARATELY from the production-safe count for exactly this reason.
 */

const MEDIAN_INCOME_WORD_TO_BOUNDARY: Record<string, MedianIncomeBoundary> = {
  "이하": "lte",
  "미만": "lt",
  "이상": "gte",
  "초과": "gt",
};

/**
 * Real MOIS median-income clauses sometimes compare a DIFFERENT figure
 * against a 기준중위소득 percentage rather than raw household income:
 * 소득인정액 ("recognized income" — assets/expenses-adjusted, a materially
 * different number than gross household income), 소득평가액 ("income
 * assessment amount" — a 국민기초생활보장법 term of art computed as actual
 * income minus household-specific expense/work-income deductions; it is the
 * component 소득인정액 is built from BEFORE adding the asset-conversion
 * amount, so it is likewise not raw declared household income — real
 * example: 서비스ID 654000000006, "가구소득평가액이 기준중위소득 50%이하"),
 * 건강보험료/건보료 (health-insurance premium band, only correlated with
 * income, not equal to it), 개인소득/본인(의) 소득 (individual, not
 * household, income), and 종합소득(금액) (an individual taxpayer's
 * aggregated tax-return income, not household income). Any of these
 * appearing near the match means the clause is NOT safely a household-income
 * comparison, so it's left unresolved rather than mis-typed as
 * `household_income` (see MedianIncomeMetric's doc in
 * domain/medianIncome/evaluate.ts).
 *
 * Whitespace-tolerant on purpose: real MOIS text sometimes inserts stray
 * spaces mid-word (observed real excerpts: "소득 인정액", "소득인 정액" for
 * what is unambiguously 소득인정액). A literal-substring check misses those
 * variants and would silently misclassify a 소득인정액 clause as
 * household_income -- a false positive this parser must never produce.
 */
const MEDIAN_INCOME_METRIC_DISQUALIFIER_RE =
  /소득\s*인\s*정\s*액|소득\s*평\s*가\s*액|건\s*강?\s*겅\s*보험\s*료|건강\s*보험\s*료|건보료|개인\s*소득|본인\s*소득|본인의\s*소득|종합\s*소득/;

/**
 * "본인" (the applicant themselves, not the household) used as an explicit
 * label directly modifying a 기준중위소득 mention, e.g. "(본인) 기준중위소득
 * 120% 이하" or "본인 기준 중위소득 130%이하" (real examples: 서비스ID
 * 627000000136 대구시 청년 지원 — which separately ALSO states "(가구)
 * 기준중위소득 140% 이하" as a DIFFERENT clause in the same record, proving
 * "본인" and "가구" are deliberately distinguished categories there; and
 * 628000000748). This is an individual-income comparison, not a
 * household-income one, so it must not be typed as `household_income`.
 * Deliberately adjacency-scoped (only whitespace/close-paren allowed between
 * "본인" and "기준중위소득") so it does NOT fire on legitimate combined-income
 * phrasing like "본인·배우자 합산 연소득이 기준 중위소득 180% 이하" (서비스ID
 * 519000000153), where "합산" (combined) sits in between and the resulting
 * combined figure IS a household-income-shaped comparison.
 */
const MEDIAN_INCOME_INDIVIDUAL_LABEL_RE = /본인\s*\)?\s*(?:기준\s*)?중위\s*소득/;

/**
 * Explicit "this varies by household size"/"per household-size table"
 * markers (e.g. "가구원 수에 따라 기준금액 상이", "가구 규모별 기준 중위소득",
 * "가구원수별"). A real MOIS record for 경기도형긴급복지지원 (서비스ID
 * 641000000164) states "기준 중위소득100% 이하(4인가구 기준 650만 원) ※ 가구원
 * 수에 따라 기준금액 상이" -- the parenthetical cites ONE household size's
 * absolute amount purely as an example, while this trailing marker proves
 * the real cutoff is a full per-size table, not a fixed reference. Treated
 * as an unconditional disqualifier alongside the metric-mismatch check
 * above.
 */
const MEDIAN_INCOME_TABLE_MARKER_RE = /가구\s*원?\s*수\s*(?:에\s*따라|별)|가구\s*규모\s*별/;

/** "N인가구"/"N인 가구"/"N인가족"/"N인 기준" — an explicit household-size number sitting next to a median-income mention (see `parseMedianIncomeClause`'s householdSizeMode logic). */
const MEDIAN_INCOME_HOUSEHOLD_SIZE_RE = /(\d{1,2})\s*인\s*(?:가구|가족|기준)/g;

/**
 * Checkpoint-5 (external-review correction, see module doc above
 * `parseMedianIncomeClause`): a clause where the compared figure is
 * unambiguously the APPLICANT'S OWN INDIVIDUAL EARNINGS (임금/wage,
 * 근로소득/labor-tax-category earned income, or an explicit "개인
 * 월평균소득"/"근로자의 월평균소득" phrasing) rather than any household-scoped
 * figure. Real MOIS examples: 서비스ID 515000000168 ("임금이 2026년 기준
 * 중위소득 150% 이하인 자" — 청년근로자 사랑채움 사업) and 587500000001 /
 * 494000000234 ("근로소득증빙이가능하고 해당 소득이 기준중위소득 170% 이하").
 * Deliberately does NOT include bare "급여" (far too ambiguous on its own —
 * routinely names a WELFARE BENEFIT TYPE in real MOIS text, e.g.
 * 생계급여/의료급여/주거급여/교육급여/해산급여/장제급여, not a wage) or bare
 * "월평균소득" (ambiguous between individual and household scope without a
 * qualifier — see 149200000018, where "월평균소득이 ... 3인 가구 기준
 * 중위소득 이하" plausibly means the HOUSEHOLD's monthly average income).
 * Both of those under-qualified forms are still safely handled: with no
 * positive household-income signal nearby either, they fall through to the
 * `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE` requirement below and end up
 * unresolved anyway, for the right general reason rather than a narrow
 * word-specific one.
 */
const MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE =
  /임금|근로\s*소득|근로자\s*의?\s*월\s*평균\s*소득|개인\s*월\s*평균\s*소득/;

/**
 * Checkpoint-5 (new): "본인·배우자 합산"/"부부합산(연)?소득"/"신청인과 배우자의
 * 소득 합계" — the applicant + spouse's COMBINED income, which is NOT
 * necessarily the same figure as total household income (a household may
 * also contain adult children, parents, or other income-earning members
 * beyond the couple). Real examples: 서비스ID 373000000116 ("부부합산소득이
 * 기준중위소득 200%..."), 402000000115 ("부부합산 소득 기준 중위소득 180%
 * 이하"), 535000000607 ("부부합산 연소득 기준 중위소득 180% 이하"), and
 * 519000000153 ("본인·배우자 합산 연소득이 기준 중위소득 180%* 이하"). Per the
 * external review: couple income != household income; this Phase does NOT
 * add a couple-income profile field/UI, so these clauses stay unresolved
 * rather than being compared against `householdIncomeRange`.
 */
const MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE =
  /부부\s*합산(?:\s*연)?\s*소득|본인\s*[·・]\s*배우자\s*합산|신청인\s*(?:과|와)?\s*배우자\s*의?\s*소득\s*합계/;

/**
 * Checkpoint-6 (manual 42-hit review correction): "원가구" ("origin
 * household" — the parental household a youth originally belongs to,
 * PARENTS + youth + co-resident family, as distinct from the youth's own
 * "독립가구"/independent household). Real MOIS youth-housing programs test
 * BOTH household definitions with an AND ("청년 원가구*의 소득이 기준 중위소득
 * 100% 이하이면서 청년 독립가구 소득이 기준 중위소득 60% 이하", 서비스ID
 * 161300000099 청년월세 지원; see also 628000000155). Neither half is safely
 * comparable to `annualHouseholdIncome`: this Phase's profile field
 * represents the APPLICANT'S OWN current household, not a combined
 * parent+child household the applicant may not even live in, and the real
 * eligibility test additionally requires BOTH thresholds to hold
 * simultaneously, which a single `median_income_threshold` rule cannot
 * express. A manual, service-by-service review of the checkpoint-5 positive-
 * signal hit set (see docs/median-income-42-hit-review.md) found this
 * parser was incorrectly emitting a rule against the 원가구 (parental)
 * threshold — the FIRST percent+boundary occurrence in the text — which is
 * the wrong figure entirely for this profile field. Deliberately matched
 * with a negative lookbehind for "지" so it does not collide with the
 * unrelated, much more common "지원가구" ("supported household") token.
 */
const MEDIAN_INCOME_PARENTAL_ORIGIN_HOUSEHOLD_DISQUALIFIER_RE = /(?<!지)원\s*가구/;

/**
 * Checkpoint-6 (manual 42-hit review correction, THE core fix): POSITIVE
 * identification of a household-scoped income label near the anchor —
 * "가구소득"/"가구원 소득"/"가구의 소득"/"가구단위 소득"/"가구 총소득"/"가구
 * 합산소득"/"세대소득"/"세대원 소득", or the anchor itself explicitly framed as
 * household-unit ("가구단위 중위소득"). This REPLACES the old "absence of a
 * known disqualifier -> assume household_income" logic, which a review of
 * the actual GitHub code correctly flagged as backwards: absence of a
 * blacklist hit never proves the measured variable is compatible with
 * `annualHouseholdIncome`/`householdIncomeBand`. A frozen-snapshot survey
 * (881 real 기준중위소득/중위소득 anchor hits) found only a small minority
 * (~40-80 raw hits, most overlapping with already-disqualified
 * 소득인정액-labeled clauses like "가구소득인정액") carry an EXPLICIT
 * household-income label at all; the overwhelming majority (774/881, ~88%)
 * carry NEITHER a positive household signal NOR a known disqualifier -- a
 * bare "기준중위소득 N% 이하" with no scoping wording whatsoever, which this
 * parser now correctly treats as `ambiguous_unqualified` (unresolved)
 * instead of silently guessing household income. Real confirmed-positive
 * examples: 서비스ID 135200005013 ("(가구소득) 기준 중위소득 50% 이하"),
 * 149200000037 ("가구원 합산 소득이 기준 중위소득의 80% 이하"), 611000019628
 * ("가구합산소득이 기준중위소득 85% 이하"), 999000000026 ("세대소득이 중위소득의
 * 46% 이하"). The bounded `[^\n]{0,4}` gap (rather than an unbounded one)
 * keeps this intentionally tight -- wide enough to cross a short connective
 * ("의", "*의 ", a footnote asterisk) but not wide enough to accidentally
 * bridge across an unrelated clause boundary. `[·・]` and other punctuation
 * inside that 4-char budget is fine; a whole extra WORD is not, by design.
 *
 * Checkpoint-6 negative-lookahead fix: the bounded gap can otherwise overlap
 * with the "소득" that is ALREADY part of the "중위소득" anchor itself, e.g.
 * "한부모가구(중위소득65% 이하)" (서비스ID 315000000104) or "전국가구 중위소득의
 * 120%이하" (서비스ID 373000000126) — in both, "가구" is a HOUSEHOLD-TYPE noun
 * (한부모가구/전국가구) with no distinct income label of its own; the "소득"
 * the old regex matched was borrowed from "중위소득" a few characters later,
 * not a genuine "가구...소득" phrase. The manual 42-hit review (see
 * docs/median-income-42-hit-review.md) confirmed these are false positives:
 * the text never actually states whose income (household? recognized
 * income? something else?) is being measured — "가구" here only names a
 * target household TYPE or is part of the benchmark's own full name
 * ("전국가구 중위소득" = "nationwide HOUSEHOLD median income", a way of
 * naming the government benchmark that says nothing about whether the
 * COMPARED figure is household-scoped). The `(?!중위)` lookahead, applied at
 * every position the gap could consume, blocks the match whenever "중위"
 * (and hence the anchor's own "소득") falls inside the gap, while leaving
 * every genuine real-positive example above untouched (none of their gaps
 * contain "중위").
 */
const MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE =
  /가구(?:\s*원)?(?:(?!중위)[^\n]){0,4}소득|세대(?:\s*원)?(?:(?!중위)[^\n]){0,4}소득|가구\s*단위\s*(?:기준\s*)?중위\s*소득/;

/** An explicit calendar year adjacent to a median-income mention, either order: "2026년 기준중위소득" / "기준중위소득 2026년". */
const MEDIAN_INCOME_YEAR_RE = /(?:(\d{4})\s*년[^\n]{0,6}중위소득|중위소득[^\n]{0,6}(\d{4})\s*년)/;

/**
 * Extracts the proven-safe subset of a "기준중위소득" clause into a
 * `median_income_threshold` rule. See the module-level doc above
 * `MEDIAN_INCOME_RE` for the overall scope/safety philosophy. Always called
 * with `MEDIAN_INCOME_RE.test(text)` already true, so `text` is guaranteed
 * to contain at least one 기준중위소득 mention.
 */
function parseMedianIncomeClause(text: string): { rule?: EligibilityRule; unresolved?: string } {
  const match = text.match(MEDIAN_INCOME_PERCENT_RE);
  if (!match) return { unresolved: text };

  const [full, percentStr, word] = match;
  const percent = Number(percentStr);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 500) return { unresolved: text };

  const matchIndex = text.indexOf(full);
  const windowStart = Math.max(0, matchIndex - 40);
  const windowEnd = Math.min(text.length, matchIndex + full.length + 20);
  const window = text.slice(windowStart, windowEnd);

  // Checkpoint-6 (manual 42-hit review correction): disqualifier terms are
  // also checked in a WIDER trailing window than the narrow ±40/+20 window
  // used for the positive-signal/individual-label checks. Real MOIS text
  // very commonly follows an anchor sentence with a trailing asterisk
  // footnote clarifying HOW the just-stated "소득기준" is actually computed
  // — e.g. 서비스ID 461000000126 (치매 진료비): "기준중위소득 140% 초과자 *
  // 소득기준 : 신청가구의 소득과 재산을 종합적으로 반영한 소득인정액" — the
  // disqualifying "소득인정액" sits ~34 characters after the match, just past
  // the narrow window's +20 reach, so the narrow window alone would
  // misclassify this as household_income even though the very next clause
  // states the real basis is 소득인정액. Deliberately asymmetric: only the
  // DISQUALIFIER checks use this wider trailing window; the positive-signal
  // and "본인" adjacency checks stay on the narrow `window` so they don't
  // start reaching across unrelated later clauses. Widening only the
  // disqualifier side can only ever move a result from household_income to
  // unresolved, never the other way — false negatives OK, false positives
  // are not.
  const disqualifierWindowEnd = Math.min(text.length, matchIndex + full.length + 150);
  const disqualifierWindow = text.slice(windowStart, disqualifierWindowEnd);

  if (
    MEDIAN_INCOME_METRIC_DISQUALIFIER_RE.test(disqualifierWindow) ||
    MEDIAN_INCOME_TABLE_MARKER_RE.test(disqualifierWindow) ||
    MEDIAN_INCOME_INDIVIDUAL_LABEL_RE.test(window) ||
    MEDIAN_INCOME_WAGE_INCOME_DISQUALIFIER_RE.test(disqualifierWindow) ||
    MEDIAN_INCOME_COUPLE_INCOME_DISQUALIFIER_RE.test(disqualifierWindow) ||
    MEDIAN_INCOME_PARENTAL_ORIGIN_HOUSEHOLD_DISQUALIFIER_RE.test(window)
  ) {
    return { unresolved: text };
  }

  // Checkpoint-5 (external-review correction): POSITIVE identification is
  // now REQUIRED, not merely "no disqualifier matched". A bare "기준중위소득
  // N% 이하" with no household-scoping wording anywhere nearby is
  // `ambiguous_unqualified`, not silently assumed to be household income --
  // see `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE`'s doc comment for the
  // full rationale and real examples.
  if (!MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE.test(window)) {
    return { unresolved: text };
  }

  const negated = isNegatedAfter(text, matchIndex + full.length);
  const effectiveWord = negated ? BOUNDARY_FLIP[word] : word;
  const boundary = MEDIAN_INCOME_WORD_TO_BOUNDARY[effectiveWord];
  if (!boundary) return { unresolved: text };

  const sizeMatches = [...window.matchAll(MEDIAN_INCOME_HOUSEHOLD_SIZE_RE)].map((m) => Number(m[1]));
  const distinctSizes = [...new Set(sizeMatches)];

  // `distinctSizes.length === 0` is the ONLY shape this parser ever emits a
  // rule for. A manual, service-by-service review of all 16 real MOIS
  // "exactly one nearby household-size number" hits from the frozen
  // snapshot (see docs/median-income-fixed-reference-review.md) found that
  // a single nearby mention is NOT a reliable `fixed_reference_household`
  // signal: only 7 of 15 distinct real services were confirmed genuinely
  // fixed-reference (and only via external corroboration this parser has no
  // access to, e.g. a named national loan program's documented standard);
  // the rest were either a truncated view of a per-household-size table cut
  // off by this function's narrow context window (e.g. 429000000646,
  // WLU000000020 — both have a full "1인/2인/3인.../7인 가구" table a few
  // dozen characters past this window's end) or a household-size number
  // that merely happened to match the described target population, not an
  // explicit fixed-reference design (e.g. 645000000122, 999000000061).
  // Per this module's safety philosophy (false negatives OK, false
  // positives are not), ANY nearby household-size number now falls back to
  // unresolved rather than ever auto-inferring `fixed_reference_household`
  // from text alone. `fixed_reference_household` remains a valid
  // `MedianIncomeThresholdSpec` shape (see domain/medianIncome/evaluate.ts)
  // for hand-authored/future explicitly-verified specs — this parser simply
  // never emits it on its own.
  if (distinctSizes.length !== 0) {
    return { unresolved: text };
  }

  const yearMatch = window.match(MEDIAN_INCOME_YEAR_RE);
  const year = yearMatch ? Number(yearMatch[1] ?? yearMatch[2]) : undefined;

  const spec: MedianIncomeThresholdSpec = {
    percent,
    boundary,
    incomeMetric: "household_income",
    householdSizeMode: "scales_with_profile_household",
    ...(year !== undefined ? { year } : {}),
  };

  return {
    rule: {
      id: `text-median-income-${boundary}-${percent}`,
      field: "householdIncomeRange",
      operator: "median_income_threshold",
      value: spec,
      required: true,
    },
  };
}

function parseIncomeClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  if (MEDIAN_INCOME_RE.test(text)) {
    return parseMedianIncomeClause(text);
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
//
// Two source signals feed a region rule:
//  - a province (optionally + a city within it), e.g. "경기도 이천시 거주자"
//  - a LONE city/county/district with no province in the same text, resolved
//    deterministically via the curated gazetteer (regionGazetteer.ts), e.g.
//    "이천시 거주자" -> 경기도/이천시. A city name that the gazetteer can't
//    place, or that genuinely exists in 2+ provinces (고성군, 중구, ...), is
//    never guessed — it's reported as unresolved instead.
//
// Only fires when the text expresses an APPLICANT RESIDENCE requirement
// (see `residenceSignalIndices`) — a bare organization/location mention like
// "이천시청에서 지원" or "접수처: 이천시청" never reaches this logic at all,
// since neither contains a residence keyword. Province mentions additionally
// require a nearby residence signal, not merely one existing anywhere in the
// (possibly multi-sentence) text — see `findProvinceRegionSpecs`.
// ---------------------------------------------------------------------------
/**
 * "주소를 둔"/"주소를 두고" ("[place]에 주소를 둔 사람" / "...주소를 두고 있는
 * 사람") are the dominant real-MOIS phrasing for "has an address registered
 * in [place]" — far more common than the old narrow literal "해당 지역에
 * 주소를 둔" it replaces, which required that exact 4-character prefix and
 * missed the overwhelming majority of real occurrences (e.g. "종로구에
 * 주소를 둔 사람", "달성군에 주소를 두고 있는 사람"). Verified via a frozen-
 * catalog frequency sweep: 352/352 "주소를 둔" and 403/403 "주소를 두고"
 * occurrences are affirmative (no "않"/"아니"/"못" negation found nearby);
 * the only negated form found, "주소를 두지" ("...두지 못하는", "...두지는
 * 않았으나"), is a distinct substring neither literal matches.
 */
const RESIDENCE_SIGNAL_PHRASES = ["거주", "주소지", "주소를 둔", "주소를 두고"];
/** "주민" alone is a safe residence signal, except as part of "주민센터" (community center), a false-positive collision. */
const RESIDENCE_AMBIGUOUS_TOKEN = "주민";
const RESIDENCE_AMBIGUOUS_TOKEN_EXCLUSION = "주민센터";
/**
 * "주민등록" (resident registration) is a genuine residence signal on its own
 * ("주민등록을 둔", "주민등록이 되어 있는") — EXCEPT when it's actually naming a
 * law/document/number rather than describing an applicant's residence
 * relation: "주민등록법" (the Resident Registration ACT), "주민등록증" (the
 * physical ID CARD), "주민등록표" (the registration RECORD/FORM), "주민등록번호"
 * (the registration NUMBER), "주민등록증명서" (the registration CERTIFICATE) all
 * name a statute or document, not a residence condition on the applicant.
 * Phase 1 item B: "주민등록법에 따른 대상자" must NOT produce a region rule
 * merely because it contains the substring "주민등록".
 */
const RESIDENCE_REGISTRATION_TOKEN = "주민등록";
const RESIDENCE_REGISTRATION_DOCUMENT_SUFFIXES = ["법", "증", "표", "번호", "증명서"];

const CITY_TOKEN_RE = /[가-힣]{2,6}(시|군|구)/;
/**
 * Real 2-character (1-char-stem) district names — 중구, 동구, 서구, 남구,
 * 북구 — that `CITY_TOKEN_RE`'s 2-6 character stem minimum structurally
 * cannot match. Matched via an exact whitelist (derived from the gazetteer
 * itself, see `getShortDistrictNames`) rather than a widened regex, so
 * common non-geographic 2-character words ending in 시/군/구 (가구, 인구,
 * 요구, 지구, 축구, 야구, ...) never get treated as a city candidate.
 */
const SHORT_DISTRICT_NAMES = getShortDistrictNames();
const SHORT_DISTRICT_ALTERNATION = SHORT_DISTRICT_NAMES.join("|");
/**
 * Combined city-token matcher: the original long-form pattern OR an exact
 * short-district whitelist match. Any match with `[0].length === 2` came
 * from the short-district branch (the long-form branch requires a minimum
 * 3-character total match) — that discriminator is used below to apply an
 * extra word-boundary safety check specific to the much-more-collision-prone
 * short tokens, without touching the existing long-form matching behavior.
 */
const CITY_TOKEN_COMBINED_RE = new RegExp(`(?:${CITY_TOKEN_RE.source})|(?:${SHORT_DISTRICT_ALTERNATION})`);
/** List-item delimiter directly between two sibling cities under the same province, e.g. "이천시, 여주시". */
const CITY_LIST_DELIMITER_RE = /^\s*(또는|,|·)\s*/;
/** Proximity window (characters) within which a lone city token must sit next to a residence-signal occurrence. */
const CITY_PROXIMITY_WINDOW = 20;

// Longest-first so "서울특별시" matches before a shorter alias would.
const PROVINCE_NAMES_DESC = [...PROVINCE_ALIAS_KEYS].sort((a, b) => b.length - a.length);

/**
 * Every index in `text` where a residence-signal phrase occurs: the plain
 * phrase list, "주민등록" when it's NOT naming a law/document/number (see
 * `RESIDENCE_REGISTRATION_DOCUMENT_SUFFIXES`), and bare "주민" when it's
 * neither "주민센터" (institution) nor part of "주민등록" (handled above, so it
 * isn't double-counted or wrongly re-included when the registration form was
 * excluded as a document reference).
 */
function residenceSignalIndices(text: string): number[] {
  const indices: number[] = [];
  for (const phrase of RESIDENCE_SIGNAL_PHRASES) {
    let idx = text.indexOf(phrase);
    while (idx !== -1) {
      indices.push(idx);
      idx = text.indexOf(phrase, idx + 1);
    }
  }

  let regIdx = text.indexOf(RESIDENCE_REGISTRATION_TOKEN);
  while (regIdx !== -1) {
    const after = text.slice(regIdx + RESIDENCE_REGISTRATION_TOKEN.length);
    const isDocumentName = RESIDENCE_REGISTRATION_DOCUMENT_SUFFIXES.some((suffix) => after.startsWith(suffix));
    if (!isDocumentName) indices.push(regIdx);
    regIdx = text.indexOf(RESIDENCE_REGISTRATION_TOKEN, regIdx + 1);
  }

  let idx = text.indexOf(RESIDENCE_AMBIGUOUS_TOKEN);
  while (idx !== -1) {
    const isRegistrationForm =
      text.slice(idx, idx + RESIDENCE_REGISTRATION_TOKEN.length) === RESIDENCE_REGISTRATION_TOKEN;
    const isInstitution =
      text.slice(idx, idx + RESIDENCE_AMBIGUOUS_TOKEN_EXCLUSION.length) === RESIDENCE_AMBIGUOUS_TOKEN_EXCLUSION;
    if (!isRegistrationForm && !isInstitution) {
      indices.push(idx);
    }
    idx = text.indexOf(RESIDENCE_AMBIGUOUS_TOKEN, idx + 1);
  }
  return indices;
}

function isNearAnyIndex(tokenIndex: number, tokenLength: number, signalIndices: number[]): boolean {
  return signalIndices.some((si) => {
    const gapAfterToken = si - (tokenIndex + tokenLength); // signal occurs after the token
    const gapAfterSignal = tokenIndex - si; // token occurs after the signal
    return (
      (gapAfterToken >= 0 && gapAfterToken <= CITY_PROXIMITY_WINDOW) ||
      (gapAfterSignal >= 0 && gapAfterSignal <= CITY_PROXIMITY_WINDOW)
    );
  });
}

/**
 * The bullet marker ("○") real MOIS `지원대상`/`선정기준` text overwhelmingly
 * uses to separate independent top-level clauses (e.g. "○ [residence
 * condition] ○ [unrelated interview-eligibility condition]") — confirmed
 * present in 8,280/10,967 frozen-catalog records' 지원대상/선정기준 text, and
 * preserved as-is by `normalizeText` (which only touches whitespace/
 * punctuation variants, never bullet characters). Used as a wider, structural
 * companion to `CITY_PROXIMITY_WINDOW`: a real residence clause can legally
 * put many characters of descriptive detail between the place name and the
 * residence keyword ("서울특별시 성동구에 영아의 출생일 포함 1년 이상 계속하여
 * ... 주민등록을 두고 실제 거주하는 부 또는 모가", real MOIS 303000000111,
 * 47 chars from mention to signal) as long as nothing else interrupts that
 * SAME clause — whereas a genuinely unrelated later clause (real MOIS
 * 351050000123's "○ 서울, 경기, 인천 소재 기업 ... 면접 응시자") must not
 * inherit an earlier clause's residence signal just because both happen to
 * share one long, multi-topic 지원대상 field.
 */
const CLAUSE_DELIMITER = "○";

/** The [start, end) span of the ○-delimited clause containing `index` (falls back to the whole text when no bullet structure is present at all). */
function clauseBoundsAt(text: string, index: number): { start: number; end: number } {
  const priorDelimiter = text.lastIndexOf(CLAUSE_DELIMITER, index);
  const nextDelimiter = text.indexOf(CLAUSE_DELIMITER, index + 1);
  return {
    start: priorDelimiter === -1 ? 0 : priorDelimiter,
    end: nextDelimiter === -1 ? text.length : nextDelimiter,
  };
}

/**
 * True when a province-mention span (`spanStart`..`spanStart + spanLength`)
 * is genuinely bound to a residence signal: either the original narrow
 * character-proximity check (unchanged, handles compact same-sentence lists
 * like "서울, 경기, 인천 거주자"), OR the signal occurs in the SAME
 * ○-delimited clause as the mention (handles a real residence clause with a
 * long descriptive relative clause in between, without also re-admitting a
 * later, structurally SEPARATE ○-clause describing something else, e.g. an
 * employer/interview location).
 */
function isBoundToResidenceSignal(text: string, spanStart: number, spanLength: number, signalIndices: number[]): boolean {
  if (isNearAnyIndex(spanStart, spanLength, signalIndices)) return true;
  const { start, end } = clauseBoundsAt(text, spanStart);
  return signalIndices.some((si) => si >= start && si < end);
}

/** True when a city-like token is immediately followed by "청" (시청/군청/구청 = a government office name, not a residence). */
function isInstitutionMention(text: string, matchEndIndex: number): boolean {
  return text.slice(matchEndIndex, matchEndIndex + 1) === "청";
}

/**
 * Resolves a city token against `province` via the gazetteer. Keeps the city
 * whenever `province` is one of the token's known real provinces — even if
 * the token ALSO exists in other, unrelated provinces (e.g. 중구 is real in
 * 서울/부산/대구/인천/대전), because the caller already supplied the province
 * from an explicit adjacent mention in the same text ("서울특별시 중구"), so
 * there's nothing left to guess: the text itself disambiguated it. A true
 * mismatch (garbled text, or a same-named city that does NOT belong to the
 * stated province) or a wholly unrecognized token safely falls back to the
 * broader, still-correct province-only spec rather than asserting a wrong
 * city-level restriction.
 *
 * `POLICY_REGION_GAZETTEER` (job B, backing `resolveCityProvinces`)
 * deliberately has no "전남광주통합특별시" province key — see
 * regionGazetteer.ts's file header — so a bare city mention never becomes
 * newly ambiguous between the old and new province names. But that means an
 * EXPLICIT "전남광주통합특별시 목포시"/"전남광주통합특별시 광산구" mention would
 * otherwise lose its city specificity here (resolveCityProvinces("목포시")
 * only ever returns ["전라남도"]), even though the text unambiguously named
 * both the current province AND a real city that belongs to it. When the
 * text explicitly names the current merged province, fall back to
 * `getCitiesForProvince` (job A's exact current-roster lookup, which DOES
 * list 전남광주통합특별시's cities) to keep that specificity — this is still
 * driven entirely by what the text itself said, not a guess, and does NOT
 * touch the lone-city (`findLoneCityCandidates`) path or its global reverse
 * index at all.
 */
function resolveCitySpec(province: string, cityToken: string | undefined): RegionSpec {
  if (!cityToken) return { province };
  const cityProvinces = resolveCityProvinces(cityToken);
  if (cityProvinces.includes(province)) {
    return { province, city: cityToken };
  }
  if (getCitiesForProvince(province).includes(cityToken)) {
    return { province, city: cityToken };
  }
  return { province };
}

/**
 * True when the match starting at `idx` sits at a real word boundary rather
 * than being embedded inside a longer name — e.g. the province alias "대구"
 * is NOT a genuine province mention inside "해운대구" (it's the tail end of a
 * single 4-character district name), but IS genuine on its own or after a
 * space/punctuation/string-start. Also used to gate the much shorter (and
 * therefore much more collision-prone) 2-character short-district tokens —
 * e.g. rejecting a spurious "동구" match inside "노동구제" (labor relief),
 * where "동구" is not a district mention at all, just a substring split
 * across the real words "노동" + "구제".
 */
function isHangulBoundaryOk(text: string, idx: number): boolean {
  if (idx === 0) return true;
  return !/[가-힣]/.test(text[idx - 1]);
}

/**
 * Closed set of characters that may directly follow a city/county/district
 * token (no space, as is normal Korean grammar) WITHOUT invalidating the
 * match: the first character of common case particles (조사) — "에"(서/는/도),
 * "은","는","이","가","을","를","의","와","과","만","나","라"(도), "로"/"으"(로),
 * "까"(지), "부"(터) — the attributive copula "인"/"일" ("...구인 학교",
 * "...구일 경우"), the contracted copula "여" ("...시여야" = "시" + "이어야",
 * "must be [city]" — verified 5/5-pure via a frozen-catalog frequency sweep
 * of `<시|군|구>여...`, all exactly "시여야", no collisions), and "민" for the
 * extremely common "구민"/"시민" ("district/city resident") compound.
 * Deliberately does NOT include characters that are overwhelmingly the START
 * of an unrelated word continuing past a coincidental 시/군/구 suffix (e.g.
 * "시설", "시행", "시장", "구역", "구성", "구입", "군경") — those must be
 * rejected, not whitelisted, which is exactly what lets "노동구제" ("구" +
 * "제") fail this check while "종로구민" ("구" + "민") passes. Derived from a
 * frequency sweep of the real MOIS catalog (see task history), not guessed.
 */
const TRAILING_BOUNDARY_OK_CHARS = new Set([
  "에", "은", "는", "이", "가", "을", "를", "의", "와", "과",
  "만", "나", "라", "로", "으", "까", "부", "인", "일", "민", "내", "여",
]);

/**
 * Closed set of whole (multi-char) words that may directly follow a
 * city/county/district token with NO space and still confirm — not just
 * fail to invalidate — a genuine place mention: "거주" (e.g. "나주시거주",
 * "청주시거주") and "관내" (e.g. "과천시관내", "홍천군관내"). Real MOIS text
 * frequently drops the space before these two specific words. Verified via
 * the same frozen-catalog frequency sweep used for `TRAILING_BOUNDARY_OK_CHARS`:
 * every real `<시|군|구>거<...>` occurrence in the catalog is "거주" (8/8) and
 * every real `<시|군|구>관<...>` occurrence is "관내" (4/4) — no observed
 * collision with an unrelated word starting the same way (e.g. "관광",
 * "관리"), so this is two specific confirmed words, not a growing blacklist
 * of single characters.
 */
const TRAILING_BOUNDARY_OK_WORDS = ["거주", "관내"];

/**
 * True when the character immediately after a city-token match is a real
 * word boundary: end of string, non-Hangul (space/punctuation/digit), or one
 * of the closed-set trailing continuations above. False when the match is
 * embedded inside a longer, unrelated Hangul word (e.g. the "구" in "노동구제"
 * is directly followed by "제", which starts neither a known particle nor
 * "민"/"내" — a real word-continuation collision, not a genuine place
 * mention).
 */
function isTrailingBoundaryOk(text: string, endIdx: number): boolean {
  const next = text[endIdx];
  if (next === undefined) return true;
  if (!/[가-힣]/.test(next)) return true;
  if (TRAILING_BOUNDARY_OK_WORDS.some((w) => text.startsWith(w, endIdx))) return true;
  return TRAILING_BOUNDARY_OK_CHARS.has(next);
}

/**
 * True when a matched token starting with "인" is immediately preceded by a
 * digit — the extremely common Korean household-size idiom "N인가구"/"N인
 * 가구" (e.g. "1인가구", "3인가구"). `CITY_TOKEN_RE`'s stem-plus-구 shape
 * greedily matches "인가구" (stem "인가" + suffix "구") right after the
 * digit, but this is a person-counter phrase, never a place. Scoped
 * narrowly to "digit directly before a token starting with 인" rather than a
 * general blacklist of "가구"-like words, per the task's hierarchy
 * preference (structural/lexical validation over an ever-growing list).
 */
function isDigitPersonCounterFalsePositive(text: string, idx: number, token: string): boolean {
  return token[0] === "인" && idx > 0 && /[0-9]/.test(text[idx - 1]);
}

/**
 * Single shared gate for "is this regex match a genuine, structurally-valid
 * city/county/district token" — used identically by both the province+city
 * path (`extractProvinceCitySpecs`) and the lone-city path
 * (`findLoneCityCandidates`) so a match that fails here is uniformly treated
 * as noise (silently skipped), never as a signal that reaches the
 * rule-vs-unresolved decision at all.
 */
function isValidCityTokenBoundary(text: string, idx: number, token: string): boolean {
  return (
    isHangulBoundaryOk(text, idx) &&
    !isDigitPersonCounterFalsePositive(text, idx, token) &&
    !isInstitutionMention(text, idx + token.length) &&
    isTrailingBoundaryOk(text, idx + token.length)
  );
}

function findNextProvinceMention(text: string, searchFrom: number): { alias: string; index: number } | undefined {
  let best: { alias: string; index: number } | undefined;
  for (const name of PROVINCE_NAMES_DESC) {
    let idx = text.indexOf(name, searchFrom);
    while (idx !== -1 && !isHangulBoundaryOk(text, idx)) {
      idx = text.indexOf(name, idx + 1);
    }
    if (idx === -1) continue;
    if (!best || idx < best.index || (idx === best.index && name.length > best.alias.length)) {
      best = { alias: name, index: idx };
    }
  }
  return best;
}

/**
 * For one province mention, resolves its immediately-following city (if
 * any), then extends through a clean, delimiter-adjacent list of sibling
 * cities under the SAME province ("경기도 이천시, 여주시 거주자"). Stops the
 * moment the list pattern breaks rather than guessing further — an
 * incomplete-but-correct extraction is fine, a wrong one is not. Returns
 * `consumedUntil` so the caller's scan for the NEXT province mention resumes
 * after every character absorbed here — otherwise a city that happens to
 * also be a valid province alias (e.g. "광주시" in "경기도 광주시") would be
 * double-counted as an independent second province mention.
 */
function extractProvinceCitySpecs(
  text: string,
  mention: { alias: string; index: number },
  province: string
): { specs: RegionSpec[]; consumedUntil: number } {
  const cursor = mention.index + mention.alias.length;
  const after = text.slice(cursor, cursor + 12);
  const firstCityMatch = after.match(CITY_TOKEN_COMBINED_RE);
  if (!firstCityMatch || firstCityMatch.index === undefined) {
    return { specs: [{ province }], consumedUntil: cursor };
  }

  const firstAbsIndex = cursor + firstCityMatch.index;
  if (!isValidCityTokenBoundary(text, firstAbsIndex, firstCityMatch[0])) {
    return { specs: [{ province }], consumedUntil: cursor };
  }

  const specs: RegionSpec[] = [resolveCitySpec(province, firstCityMatch[0])];
  let scanFrom = firstAbsIndex + firstCityMatch[0].length;

  for (;;) {
    const rest = text.slice(scanFrom);
    const delimiterMatch = rest.match(CITY_LIST_DELIMITER_RE);
    if (!delimiterMatch) break;
    const afterDelimiter = rest.slice(delimiterMatch[0].length);
    const siblingMatch = afterDelimiter.match(CITY_TOKEN_COMBINED_RE);
    if (!siblingMatch || siblingMatch.index !== 0) break; // must be immediately adjacent, never guessed from further away
    const siblingAbsIndex = scanFrom + delimiterMatch[0].length;
    if (!isValidCityTokenBoundary(text, siblingAbsIndex, siblingMatch[0])) break;
    specs.push(resolveCitySpec(province, siblingMatch[0]));
    scanFrom = siblingAbsIndex + siblingMatch[0].length;
  }

  return { specs, consumedUntil: scanFrom };
}

/**
 * Single left-to-right pass over the whole text: finds every genuine
 * province mention (respecting word boundaries), resolves each one's
 * city/sibling-list, and advances the scan cursor past everything just
 * consumed before looking for the next mention. Returns `[]` when no
 * genuine province mention exists anywhere (the caller then falls back to
 * gazetteer-backed lone-city resolution).
 *
 * Each mention (plus its resolved city / sibling-city-list, i.e. the whole
 * consumed span) must sit near a residence-signal occurrence — the SAME
 * `residenceSignalIndices`/`isNearAnyIndex`/`CITY_PROXIMITY_WINDOW`
 * proximity gate the lone-city path (`findLoneCityCandidates`) already
 * uses — before it's allowed to become part of a `region_in` spec. Without
 * this, `parseRegionClause`'s clause-level residence-signal-presence check
 * only proves SOME residence signal exists somewhere in the (possibly
 * multi-sentence) text, not that any given province mention is the thing
 * that signal is describing. Real MOIS example (351050000123, "미추홀구 청년
 * 면접수당 지원"): "인천광역시 미추홀구에 주민등록되어있는 ... 청년. 서울,
 * 경기, 인천 소재 기업 및 공공기관 취업면접 ... 응시자" — "주민등록" binds only
 * to "인천광역시 미추홀구"; the second sentence's "서울, 경기, 인천" names the
 * INTERVIEW-eligible employer location, not applicant residence, and must
 * NOT become an allowed residence alternative. A mention that fails the
 * proximity check is dropped from the result (not reported unresolved —
 * exactly as a lone-city token that fails `isValidCityTokenBoundary` is
 * silently treated as noise, never as a signal reaching the rule-vs-
 * unresolved decision), while the scan cursor still advances past it so
 * scanning for the next genuine mention continues uninterrupted. A compact
 * OR list ("서울, 경기, 인천 거주자") stays intact because each member's own
 * span sits within `CITY_PROXIMITY_WINDOW` of the single trailing "거주"
 * signal — no per-element residence word is required.
 */
function findProvinceRegionSpecs(text: string, signalIndices: number[]): RegionSpec[] {
  const specs: RegionSpec[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const mention = findNextProvinceMention(text, cursor);
    if (!mention) break;
    const province = normalizeProvince(mention.alias);
    if (!province) {
      cursor = mention.index + mention.alias.length;
      continue;
    }
    const result = extractProvinceCitySpecs(text, mention, province);
    const spanLength = result.consumedUntil - mention.index;
    if (isBoundToResidenceSignal(text, mention.index, spanLength, signalIndices)) {
      specs.push(...result.specs);
    }
    cursor = result.consumedUntil;
  }
  return specs;
}

/**
 * Resolves every lone city/county/district mention (no province anywhere in
 * the text) that sits near a residence-signal occurrence and passes
 * structural boundary validation (`isValidCityTokenBoundary`) — i.e. isn't
 * embedded inside a longer unrelated word ("노동구제"'s "노동구"), isn't a
 * digit-prefixed person-counter ("1인가구"'s "인가구"), and isn't an
 * institution-name false positive ("이천시청"). All-or-nothing per
 * BOUNDARY-VALID token: a boundary-valid token that's either unrecognized by
 * the gazetteer (e.g. "없는시" — genuinely place-shaped, standalone, just not
 * in our data) or genuinely cross-province-ambiguous (e.g. 고성군, 중구)
 * marks the whole clause unresolved rather than silently dropping just that
 * one entry from an OR'd list — a token that FAILS boundary validation never
 * reaches this decision at all, since it was never a real place mention to
 * begin with.
 */
function findLoneCityCandidates(text: string): { specs: RegionSpec[]; hadUnresolvableToken: boolean } {
  const signalIndices = residenceSignalIndices(text);
  const specs: RegionSpec[] = [];
  const seen = new Set<string>();
  let hadUnresolvableToken = false;

  const re = new RegExp(CITY_TOKEN_COMBINED_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const token = match[0];
    const idx = match.index;
    if (!isValidCityTokenBoundary(text, idx, token)) continue;
    if (!isNearAnyIndex(idx, token.length, signalIndices)) continue;

    const provinces = resolveCityProvinces(token);
    if (provinces.length === 1) {
      const key = `${provinces[0]}|${token}`;
      if (!seen.has(key)) {
        seen.add(key);
        specs.push({ province: provinces[0], city: token });
      }
    } else {
      // Either genuinely ambiguous (2+ real provinces, e.g. 중구) or a
      // wholly-unrecognized-but-structurally-valid place-like token (0
      // provinces, e.g. 없는시): both passed boundary validation, so both
      // are real, residence-adjacent place-shaped mentions we can't safely
      // resolve — reported as unresolved rather than guessed OR dropped.
      hadUnresolvableToken = true;
    }
  }

  return { specs, hadUnresolvableToken };
}

function parseRegionClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const signalIndices = residenceSignalIndices(text);
  if (signalIndices.length === 0) return undefined;

  const provinceSpecs = findProvinceRegionSpecs(text, signalIndices);
  if (provinceSpecs.length > 0) {
    return {
      rule: { id: "text-region", field: "residence", operator: "region_in", value: provinceSpecs, required: true },
    };
  }

  // No province mention anywhere: try gazetteer-backed lone-city resolution.
  const { specs, hadUnresolvableToken } = findLoneCityCandidates(text);
  if (specs.length > 0 && !hadUnresolvableToken) {
    return {
      rule: { id: "text-region", field: "residence", operator: "region_in", value: specs, required: true },
    };
  }
  // A real, boundary-validated geographic signal exists (an
  // unresolved/ambiguous city token, or some structurally-valid city-like
  // token we couldn't safely place) but we can't turn it into a rule —
  // report it rather than silently dropping it. Deliberately does NOT fall
  // back to a raw, unvalidated `CITY_TOKEN_COMBINED_RE.test(text)` scan
  // (Phase 1 root-cause fix): that used to bypass every boundary/proximity/
  // institution-exclusion check this function just applied, so a phantom
  // substring match like "노동구" inside "노동구제" (already correctly
  // rejected above) would still flip this clause to "unresolved" through
  // the back door. `findLoneCityCandidates` is now the single source of
  // truth for "did a genuine place-shaped token exist in this text at all".
  if (hadUnresolvableToken) return { unresolved: text };
  return undefined;
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
// CHILDREN COUNT (sections 12, 35) — Phase 2 family/marital audit
// ---------------------------------------------------------------------------
/**
 * "자녀 N명 이상" / "자녀 N인 이상" — the cleanest bucket in the Phase 2 real-
 * MOIS audit (31 matches / 30 distinct records, no observed false positives).
 * Deliberately does NOT attempt to resolve bare "다자녀(가구)" with no
 * accompanying number (350 matches / 346 records in the audit, the large
 * majority with no numeric definition in the same text) — per the Phase 2
 * spec, guessing a fixed 2 or 3 threshold for "다자녀" is exactly the kind of
 * imagined-not-measured rule this project must not produce.
 */
const CHILDREN_COUNT_RE = /자녀\s*(\d+)\s*(?:명|인)\s*(이상|초과)/;
const MULTI_CHILD_BARE_RE = /다자녀/;

function parseChildrenClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const match = text.match(CHILDREN_COUNT_RE);
  if (match) {
    const [full, countStr, word] = match;
    const count = Number(countStr);
    const matchIndex = text.indexOf(full);
    const negated = isNegatedAfter(text, matchIndex + full.length);
    const effectiveCount = word === "초과" ? count + 1 : count;
    if (negated) {
      // "자녀 2명 이상이 아닌" -> exact logical negation is "< 2".
      return {
        rule: { id: "text-children-lt", field: "childrenCount", operator: "lt", value: effectiveCount, required: true },
      };
    }
    return {
      rule: { id: "text-children-gte", field: "childrenCount", operator: "gte", value: effectiveCount, required: true },
    };
  }
  // Bare "다자녀" with no explicit number found anywhere in this text: a real
  // family signal we can't safely turn into a threshold.
  if (MULTI_CHILD_BARE_RE.test(text)) return { unresolved: text };
  return undefined;
}

// ---------------------------------------------------------------------------
// MARITAL / FAMILY (Phase 2 audit) — 한부모, 다문화가족, 혼인기간 N년 이내.
//
// Reuses the exact "제외" negation + evidence conventions established above.
// Per the audit, three buckets are the only ones with clean, direct-
// applicant, high-volume real phrasing (see scripts/auditFamilyEligibilityFrozen.ts
// output): 한부모(가족/가정) (650 records, refined; 904 matches), 다문화가족
// (156 records), and
// 혼인(신고)?...N년 이내 (51 records, with real, VARYING thresholds — never a
// fixed 5/7-year guess). Everything else audited (배우자, 출산/임신,
// 세대/가구구성, bare 미혼/기혼, 새터민, 조손가족, 예비신혼부부) was found to be
// either dominated by false positives relative to applicant eligibility, or
// too low-volume / structurally unrepresentable with the current
// MaritalStatus enum, and is intentionally left unimplemented this phase.
// ---------------------------------------------------------------------------

/**
 * "미혼 여부와 관계없이" / "자녀 유무와 관계없이"-style phrasing must produce NO
 * restriction at all (not even "unresolved") — the source text is explicitly
 * stating the field does NOT gate eligibility, so surfacing it as an
 * unresolved clause would misleadingly suggest there's a real ambiguous rule
 * to chase down. Checked in a short window immediately after the keyword.
 */
const RELEVANCE_NEGATION_RE = /관계없이|무관하게|상관없이/;
function statesFieldIrrelevant(text: string, matchEnd: number, window = 12): boolean {
  return RELEVANCE_NEGATION_RE.test(text.slice(matchEnd, matchEnd + window));
}

/**
 * Real MOIS eligibility text very often lists 한부모/다문화가족 as ONE of
 * several alternative disadvantaged-status categories a person may qualify
 * under (e.g. "국민기초생활 보장법에 따른 수급자 또는 차상위계층, 한부모가족지원법에
 * 따른 지원대상자, 장애인연금법에 따른 수급자" — any ONE of several unrelated
 * statuses is sufficient). None of those sibling categories (수급자,
 * 차상위계층, 장애인연금, 국가유공자, ...) are things this parser's income/other
 * extractors turn into a rule from this same categorical-membership phrasing
 * (they require explicit numeric income text, not a legal-citation label),
 * so the existing cross-dimension OR safety net (`hasLocalCrossDimensionOr`,
 * which only fires when 2+ of our OWN extracted rule fields collide near an
 * OR word) can't see this danger at all — a single-field extraction would
 * sail through unguarded and wrongly turn "one of several qualifying
 * categories" into a hard AND-required rule. This local guard closes that
 * gap: if another known status-category token sits near the match, joined by
 * a list delimiter, the clause is reported as unresolved instead.
 */
const SIBLING_STATUS_CATEGORY_RE = /수급자|차상위|장애인연금|국가유공자|새터민|북한이탈주민|조손/;
const LIST_DELIMITER_RE = /또는|,|및|·/;
function hasNearbySiblingStatusCategory(text: string, matchIndex: number, matchLength: number, window = 30): boolean {
  const before = text.slice(Math.max(0, matchIndex - window), matchIndex);
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + window);
  return (
    (SIBLING_STATUS_CATEGORY_RE.test(before) && LIST_DELIMITER_RE.test(before)) ||
    (SIBLING_STATUS_CATEGORY_RE.test(after) && LIST_DELIMITER_RE.test(after))
  );
}

/**
 * "제외" attaches to whatever clause it's grammatically part of — real MOIS
 * text frequently starts an UNRELATED new bulleted clause with "제외" shortly
 * after an earlier family-keyword mention (e.g. "...한부모가족 ○ 제외대상(중복
 * 수혜 불가) - 장애인은..." — the exclusion is about a DIFFERENT category,
 * 장애인, not 한부모가족). A bare short-window substring test can't tell these
 * apart and would wrongly flip a real eligible-category mention into a false
 * exclusion. Scoped to stop at the first bullet/list-break marker so only a
 * "제외" that's still part of the SAME clause (immediately attached, at most a
 * short particle away) counts.
 */
const EXCLUSION_BREAK_RE = /[○●◦▪‣·\-\n]/;
function isExcludedAfter(text: string, endIndex: number, window = 8): boolean {
  const after = text.slice(endIndex, endIndex + window);
  const breakIdx = after.search(EXCLUSION_BREAK_RE);
  const scoped = breakIdx === -1 ? after : after.slice(0, breakIdx);
  return scoped.includes("제외");
}

/**
 * "한(\s?)부모(\s?(?:가족|가정))?" — captures the space between 한/부모 (group 1)
 * and any 가족/가정 suffix (group 2) so `isGenuineSingleParentMatch` below can
 * apply the two real-audit-driven false-positive guards. Field renamed
 * `singleParent` -> `singleParentFamily` (see types/profile.ts): real MOIS
 * text qualifies BOTH the parent and their child under the same clause
 * ("미혼한부모 및 그자녀"), so the field means family MEMBERSHIP, not "is
 * themselves a parent".
 */
const SINGLE_PARENT_CORE_RE = /한(\s?)부모(\s?(?:가족|가정))?/g;
const MIHONMO_BU_RE = /미혼모|미혼부/;

/**
 * Two real-audit-driven false positives for the "한부모" family (see the
 * Phase 2 checkpoint-2 한부모 sub-bucket re-audit against the frozen
 * snapshot):
 *
 * 1. "-한 부모" verb-ending collision: ONLY when 한/부모 are SPACE-separated
 *    (the fused "한부모" spelling has zero observed false positives — every
 *    real fused-prefix hit like "법정한부모"/"미혼한부모"/"청소년한부모" is
 *    genuine), a preceding verb stem's "-한" ending directly abuts a
 *    following "부모" noun with nothing but whitespace between them: "카드를
 *    소지한 부모" (parents WHO HOLD a card), "아동을 입양한 부모" (parents WHO
 *    ADOPTED a child), "출산한 부모" (parents WHO GAVE BIRTH), "위한 부모"
 *    ("for parents"/"부모튜토리얼") — none of these are the legal 한부모
 *    category, they're "한" as the tail of an unrelated preceding verb.
 *    Filtered via `isHangulBoundaryOk`, the same word-boundary check the
 *    region extractor already uses: a genuine "한 부모" mention is preceded
 *    by whitespace/punctuation/string-start, never by another Hangul
 *    character.
 * 2. "한(부모| 부모) 이상" numeral idiom: "한 부모 이상과 학생이 ...주소를 둔자"
 *    (real MOIS 540000000110/114/129, both the spaced 지원대상 spelling AND
 *    the fused "한부모이상" 선정기준 spelling) means "one parent OR MORE", an
 *    ordinary-language headcount, not the legal 한부모 category — the legal
 *    term is a status label, "이상" never meaningfully follows it. Filtered
 *    by checking for a following bare "이상" whenever no 가족/가정 suffix was
 *    captured (a genuine "한부모가족"/"한부모가정" match can't collide with
 *    this idiom).
 */
function isGenuineSingleParentMatch(text: string, match: RegExpExecArray): boolean {
  const hasSpace = match[1] === " ";
  const hasFamilySuffix = Boolean(match[2]);
  if (hasSpace && !isHangulBoundaryOk(text, match.index)) return false;
  if (!hasFamilySuffix) {
    const endIdx = match.index + match[0].length;
    if (/^\s?이상/.test(text.slice(endIdx, endIdx + 3))) return false;
  }
  return true;
}

function findSingleParentCoreMatch(text: string): RegExpExecArray | undefined {
  const re = new RegExp(SINGLE_PARENT_CORE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isGenuineSingleParentMatch(text, m)) return m;
  }
  return undefined;
}

function parseSingleParentClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const core = findSingleParentCoreMatch(text);
  const solo = MIHONMO_BU_RE.exec(text);

  let matchIndex: number;
  let matchEnd: number;
  if (core && (!solo || core.index <= solo.index)) {
    matchIndex = core.index;
    matchEnd = core.index + core[0].length;
  } else if (solo) {
    matchIndex = solo.index;
    matchEnd = solo.index + solo[0].length;
  } else {
    return undefined;
  }

  if (statesFieldIrrelevant(text, matchEnd)) return undefined;

  const negated = isNegatedAfter(text, matchEnd) || isExcludedAfter(text, matchEnd);
  if (negated) {
    return {
      rule: { id: "text-single-parent-excl", field: "singleParentFamily", operator: "eq", value: false, required: true },
    };
  }

  if (hasNearbySiblingStatusCategory(text, matchIndex, matchEnd - matchIndex)) {
    return { unresolved: text };
  }

  return {
    rule: { id: "text-single-parent", field: "singleParentFamily", operator: "eq", value: true, required: true },
  };
}

const MULTICULTURAL_FAMILY_RE = /다문화\s?(?:가족|가정)/g;

function parseMulticulturalFamilyClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  const re = new RegExp(MULTICULTURAL_FAMILY_RE.source, "g");
  const match = re.exec(text);
  if (!match) return undefined;

  if (statesFieldIrrelevant(text, match.index + match[0].length)) return undefined;

  const negated = isNegatedAfter(text, match.index + match[0].length) || isExcludedAfter(text, match.index + match[0].length);
  if (negated) {
    return {
      rule: { id: "text-multicultural-excl", field: "multiculturalFamily", operator: "eq", value: false, required: true },
    };
  }

  if (hasNearbySiblingStatusCategory(text, match.index, match[0].length)) {
    return { unresolved: text };
  }

  return {
    rule: { id: "text-multicultural", field: "multiculturalFamily", operator: "eq", value: true, required: true },
  };
}

/**
 * "혼인(신고)?(일)?...N년 (이내|미만|이하|초과|이상)" — also accepts "결혼" as a
 * synonym root (real example: "결혼 7년 이하의 무주택 신혼부부"). The real audit
 * confirmed genuinely DIFFERENT thresholds across policies (6 months, 1, 2,
 * 3, 5, 7 years) — this pattern only ever extracts the number actually
 * present in THIS text, never a guessed default.
 */
const MARRIAGE_DURATION_YEARS_RE =
  /(?:혼인|결혼)(?:신고)?\s*(?:일)?\s*(?:기준|로부터|후)?\s*[^.\n]{0,6}?(\d{1,2})\s*년\s*(이내|미만|이하|초과|이상)/;

/**
 * Month-based marriage-duration wording ("혼인신고일로부터 6개월 이내") is
 * intentionally reported as `unresolved`, never a rule — a checkpoint-2
 * targeted re-audit of the frozen snapshot found 14 real "N개월
 * (이내|미만|이하|초과|이상)" occurrences near 혼인/결혼, and unlike the year-based
 * bucket this is NOT a clean single-meaning bucket: it's dominated by (a)
 * "N개월 이상 거주" — a RESIDENCE duration counted FROM the marriage date, not
 * a marital-duration condition itself (real: "혼인신고일로부터 부부 모두 6개월
 * 이상 보은군에 거주"), and (b) pre-marriage "N개월 이내 혼인신고 예정" text
 * describing an INTENDED future marriage, not a current one (real: "결혼식 후
 * 3개월 이내 혼인 신고 예정"). Guessing which reading applies from the text
 * alone risks silently attaching the threshold to the wrong field (residence,
 * not marriage) or asserting the applicant IS currently married when they're
 * only planning to be — exactly the imagined-not-measured failure mode
 * Phase 2 must avoid. So this pattern is detected (surfaced as a real,
 * traceable signal) but never resolved into a rule.
 */
const MARRIAGE_DURATION_MONTHS_RE =
  /(?:혼인|결혼)(?:신고)?\s*(?:일)?\s*(?:기준|로부터|후)?\s*[^.\n]{0,6}?(\d{1,2})\s*개월\s*(이내|미만|이하|초과|이상)/;

const MARRIAGE_DURATION_WORD_TO_BOUNDARY: Record<string, MarriageDurationBoundary> = {
  "이내": "lte",
  "이하": "lte",
  "미만": "lt",
  "이상": "gte",
  "초과": "gt",
};

const NEWLYWED_BARE_RE = /신혼부부/;
/**
 * A clearly-CURRENT "신혼부부" mention — excludes "예비신혼부부" (not yet
 * married) via the negative lookbehind. Per Step 3: only a duration clause
 * attached to a CURRENT 신혼부부 reading may additionally assert
 * `maritalStatus == "married"` (a divorced/widowed applicant with a recent
 * *historical* marriage date must not pass a current-신혼부부 gate just
 * because their marriageDate alone satisfies the duration window).
 * "예비신혼부부"/"혼인 예정"/an ambiguous OR-combination never reach this —
 * they either don't match at all, or (혼인 예정 alone, no 신혼부부 word) simply
 * never trigger the compound rule below.
 */
const NEWLYWED_CURRENT_RE = /(?<!예비\s?)신혼부부/;

function parseMarriageDurationClause(text: string): { rules?: EligibilityRule[]; unresolved?: string } | undefined {
  const match = text.match(MARRIAGE_DURATION_YEARS_RE);
  if (match) {
    const [full, yearsStr, word] = match;
    const years = Number(yearsStr);
    const matchIndex = text.indexOf(full);
    const negated = isNegatedAfter(text, matchIndex + full.length);
    const effectiveWord = negated ? BOUNDARY_FLIP[word] : word;
    const boundary = MARRIAGE_DURATION_WORD_TO_BOUNDARY[effectiveWord];
    if (!boundary) return undefined;

    const spec: MarriageDurationSpec = { years, boundary };
    const durationRule: EligibilityRule = {
      id: `text-marriage-duration-${boundary}`,
      field: "marriageDate",
      operator: "marriage_duration_within",
      value: spec,
      required: true,
    };

    // A clearly-CURRENT 신혼부부 condition with an explicit duration implies
    // BOTH conditions must hold — the applicant must actually be currently
    // married, not merely have a marriageDate on file from a since-ended
    // marriage (see NEWLYWED_CURRENT_RE doc above).
    if (NEWLYWED_CURRENT_RE.test(text)) {
      const maritalRule: EligibilityRule = {
        id: "text-marriage-duration-implies-married",
        field: "maritalStatus",
        operator: "eq",
        value: "married",
        required: true,
      };
      return { rules: [maritalRule, durationRule] };
    }

    return { rules: [durationRule] };
  }

  if (MARRIAGE_DURATION_MONTHS_RE.test(text)) return { unresolved: text };

  // "신혼부부"/"예비신혼부부" mentioned but this text never states its own
  // duration threshold: real signal, no safe (never-guessed) resolution.
  if (NEWLYWED_BARE_RE.test(text)) return { unresolved: text };
  return undefined;
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
// Phase 1 item C: clause-LOCAL cross-dimension OR safety net.
//
// The old safety net (see `extractEligibilityFromText` below, prior version)
// asked one whole-document question — "does '또는'/'혹은'/... appear ANYWHERE
// in this text?" — and, if so, discarded every independently-extracted rule
// the moment 2+ were found, regardless of where in a long document the OR
// word actually sat relative to those rules. On real MOIS text (which often
// mixes an unrelated "본인 또는 배우자" or a numbered "1) ... 또는 2) ..."
// sub-list far from the actual eligibility dimensions) that wiped genuine,
// unrelated high-confidence rules for no real ambiguity reason.
//
// This replacement reasons at the OR-OCCURRENCE level instead: for each
// individual OR-signal occurrence, look at a small character window AROUND
// IT ONLY, and check whether 2+ of the fields we actually extracted rules
// for have a trigger signal inside that window. Only THEN is there real
// evidence that a specific OR is joining two of our extracted dimensions
// together (e.g. "대학생 또는 미취업자" — both signals sit right next to the
// same 또는) — never AND an explicit OR, but also never let an OR word that
// happens to exist somewhere far away in the document silently discard
// unrelated, unambiguous rules.
//
// The window is deliberately ASYMMETRIC, not a single ±N span. Real MOIS
// text overwhelmingly uses one recurring shape that a symmetric window
// mis-fires on: "<residence description> <주민/구민/시민/군민> 또는 그 자녀(로서)
// <trailing clause that happens to mention education/age/...>" — e.g.
// "달서구 관내 주소를 두고 거주하는 구민 또는 그 자녀로서 고등학교에 재학중인 학생".
// Here "또는" joins two SUBJECT alternatives (the resident / the resident's
// child) that are BOTH still governed by the same residence clause — it is
// not actually crossing residence with education. But a wide symmetric
// window picks up the residence trigger ("거주하는") sitting ~8 chars
// *before* "구민 또는" and wrongly pairs it with the education trigger
// ("학생") sitting well *after* "그 자녀로서" purely by proximity coincidence,
// wiping a perfectly good residence rule. Genuine cross-dimension ORs (e.g.
// "재학생 또는 영도구 관내 거주 대학생") never need to reach far to their LEFT —
// the first disjunct's own trigger sits immediately before the OR word — so
// shrinking only the BEFORE side filters out the shared-subject-prefix
// false positives above without losing real detections. The AFTER side
// stays wide because a disjunct's own trigger can legitimately sit a few
// words into its noun phrase (as in "영도구 관내 거주 대학생").
// ---------------------------------------------------------------------------
const OR_WINDOW_BEFORE = 6;
const OR_WINDOW_AFTER = 25;

function findOrSignalOccurrences(text: string): number[] {
  const indices: number[] = [];
  for (const signal of OR_SIGNALS) {
    let idx = text.indexOf(signal);
    while (idx !== -1) {
      indices.push(idx);
      idx = text.indexOf(signal, idx + signal.length);
    }
  }
  return indices;
}

/**
 * Whether the given field's own high-confidence trigger substring/pattern
 * (the same signal its own `parse*Clause` function keys off of) appears
 * inside `window`. Deliberately reuses each field's real trigger rather than
 * a generic keyword list, so this stays in lockstep with the extractors
 * above instead of drifting into its own parallel NLP layer.
 */
/**
 * Whether `window` contains a city/county/district token that would actually
 * survive the SAME structural boundary validation the real region extractor
 * uses (`isValidCityTokenBoundary`) — unlike a bare `CITY_TOKEN_COMBINED_RE`
 * test, which also "matches" extremely common non-place false positives
 * (e.g. "근로시간"'s "근로시", "반드시", "거주시", "신청시") that the real
 * extractor already knows how to reject. Using the unguarded regex here let
 * these false city-tokens masquerade as a residence signal purely inside the
 * OR safety net, wrongly wiping unrelated, unambiguous rules (e.g. "미취업
 * 혹은 근로시간 주 30시간 미만" wiping an age+region+employment record whose
 * "또는"/"혹은" had nothing to do with residence at all).
 */
function hasBoundaryValidCityToken(window: string): boolean {
  const re = new RegExp(CITY_TOKEN_COMBINED_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(window)) !== null) {
    if (isValidCityTokenBoundary(window, match.index, match[0])) return true;
  }
  return false;
}

function ruleFieldSignalPresent(field: string, window: string): boolean {
  switch (field) {
    case "age":
      return /\d{1,3}\s*세\s*(이상|초과|이하|미만)/.test(window);
    case "residence":
      return (
        RESIDENCE_SIGNAL_PHRASES.some((p) => window.includes(p)) ||
        window.includes(RESIDENCE_REGISTRATION_TOKEN) ||
        hasBoundaryValidCityToken(window) ||
        PROVINCE_NAMES_DESC.some((p) => window.includes(p))
      );
    case "educationStatus":
      return /대학원생|대학생|고등학생|학생/.test(window);
    case "employmentStatus":
      return /미취업|재직/.test(window);
    case "homeowner":
      return /무주택|주택\s*보유자/.test(window);
    case "businessOwner":
      return window.includes("사업자등록");
    case "individualIncomeRange":
    case "householdIncomeRange":
      return /연\s?소득|(?:기준\s*)?중위\s*소득/.test(window);
    case "childrenCount":
      return /자녀\s*\d+\s*(?:명|인)/.test(window);
    case "singleParentFamily":
      return /한\s?부모|미혼모|미혼부/.test(window);
    case "multiculturalFamily":
      return /다문화\s?(?:가족|가정)/.test(window);
    case "marriageDate":
      return /(?:혼인|결혼)(?:신고)?|신혼부부/.test(window);
    // "maritalStatus" deliberately has NO case here: it is never
    // independently extracted from its own signal anywhere else in this
    // file — the only rule this parser ever produces for it is the
    // maritalStatus=="married" half of the marriage-duration compound rule
    // above, which is always emitted TOGETHER with (never independently of)
    // the marriageDate rule from the exact same regex match. Since the two
    // fields aren't independently discoverable, they can't be "wrongly
    // joined" by a distant, unrelated OR the way two genuinely independent
    // dimensions could — so this safety net correctly never needs to reason
    // about maritalStatus on its own.
    default:
      return false;
  }
}

/**
 * True only when a SPECIFIC OR-signal occurrence has 2+ distinct
 * already-extracted rule fields' trigger signals within its (asymmetric,
 * see `OR_WINDOW_BEFORE`/`OR_WINDOW_AFTER` above) character window — i.e.
 * this exact "또는"/"혹은"/... is plausibly joining two of the dimensions we
 * extracted, not just co-existing somewhere in the same (possibly very
 * long) document.
 */
function hasLocalCrossDimensionOr(text: string, rules: EligibilityRule[]): boolean {
  const fields = [...new Set(rules.map((r) => r.field))];
  if (fields.length < 2) return false;
  for (const idx of findOrSignalOccurrences(text)) {
    const start = Math.max(0, idx - OR_WINDOW_BEFORE);
    const end = Math.min(text.length, idx + OR_WINDOW_AFTER);
    const window = text.slice(start, end);
    const presentFields = fields.filter((f) => ruleFieldSignalPresent(f, window));
    if (presentFields.length >= 2) return true;
  }
  return false;
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
  if (children?.rule) rules.push(withEvidence(children.rule, sourceField, text));
  else if (children?.unresolved) unresolvedClauses.push(children.unresolved);

  const singleParent = parseSingleParentClause(text);
  if (singleParent?.rule) rules.push(withEvidence(singleParent.rule, sourceField, text));
  else if (singleParent?.unresolved) unresolvedClauses.push(singleParent.unresolved);

  const multiculturalFamily = parseMulticulturalFamilyClause(text);
  if (multiculturalFamily?.rule) rules.push(withEvidence(multiculturalFamily.rule, sourceField, text));
  else if (multiculturalFamily?.unresolved) unresolvedClauses.push(multiculturalFamily.unresolved);

  const marriageDuration = parseMarriageDurationClause(text);
  if (marriageDuration?.rules) {
    for (const r of marriageDuration.rules) rules.push(withEvidence(r, sourceField, text));
  } else if (marriageDuration?.unresolved) {
    unresolvedClauses.push(marriageDuration.unresolved);
  }

  // Safety net (section 16, Phase 1 item C): if a SPECIFIC OR occurrence in
  // the text is plausibly joining two of the dimensions we just extracted
  // (see `hasLocalCrossDimensionOr`), don't silently AND our independently-
  // extracted rules together — that could turn "A 또는 B" into a
  // (wrong, stricter) "A AND B". Bail out to unresolved instead. Scoped to
  // the OR occurrence's local neighborhood rather than "does an OR word
  // exist anywhere in this (possibly long) document", so an unrelated
  // "본인 또는 배우자" or a numbered "1) ... 또는 2) ..." sub-list elsewhere in
  // the text no longer wipes unrelated, unambiguous rules.
  if (rules.length >= 2 && hasLocalCrossDimensionOr(text, rules)) {
    unresolvedClauses.push(text);
    return { rules: [], unresolvedClauses };
  }

  return { rules, unresolvedClauses };
}
