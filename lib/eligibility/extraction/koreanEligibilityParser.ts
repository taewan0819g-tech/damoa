import type { EligibilityRule } from "@/types/benefit";
import { normalizeProvince, PROVINCE_ALIAS_KEYS, type RegionSpec } from "../region";
import { resolveCityProvinces, getShortDistrictNames } from "../regionGazetteer";
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
// (see `hasResidenceSignal`) — a bare organization/location mention like
// "이천시청에서 지원" or "접수처: 이천시청" never reaches this logic at all,
// since neither contains a residence keyword.
// ---------------------------------------------------------------------------
const RESIDENCE_SIGNAL_PHRASES = ["거주", "주민등록", "주소지", "해당 지역에 주소를 둔"];
/** "주민" alone is a safe residence signal, except as part of "주민센터" (community center), a false-positive collision. */
const RESIDENCE_AMBIGUOUS_TOKEN = "주민";
const RESIDENCE_AMBIGUOUS_TOKEN_EXCLUSION = "주민센터";

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

/** Every index in `text` where a residence-signal phrase occurs (bare "주민" excluding "주민센터"). */
function residenceSignalIndices(text: string): number[] {
  const indices: number[] = [];
  for (const phrase of RESIDENCE_SIGNAL_PHRASES) {
    let idx = text.indexOf(phrase);
    while (idx !== -1) {
      indices.push(idx);
      idx = text.indexOf(phrase, idx + 1);
    }
  }
  let idx = text.indexOf(RESIDENCE_AMBIGUOUS_TOKEN);
  while (idx !== -1) {
    if (text.slice(idx, idx + RESIDENCE_AMBIGUOUS_TOKEN_EXCLUSION.length) !== RESIDENCE_AMBIGUOUS_TOKEN_EXCLUSION) {
      indices.push(idx);
    }
    idx = text.indexOf(RESIDENCE_AMBIGUOUS_TOKEN, idx + 1);
  }
  return indices;
}

function hasResidenceSignal(text: string): boolean {
  return residenceSignalIndices(text).length > 0;
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
 */
function resolveCitySpec(province: string, cityToken: string | undefined): RegionSpec {
  if (!cityToken) return { province };
  const cityProvinces = resolveCityProvinces(cityToken);
  if (cityProvinces.includes(province)) {
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
  if (firstCityMatch[0].length === 2 && !isHangulBoundaryOk(text, firstAbsIndex)) {
    return { specs: [{ province }], consumedUntil: cursor };
  }
  if (isInstitutionMention(text, firstAbsIndex + firstCityMatch[0].length)) {
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
    if (siblingMatch[0].length === 2 && !isHangulBoundaryOk(text, siblingAbsIndex)) break;
    if (isInstitutionMention(text, siblingAbsIndex + siblingMatch[0].length)) break;
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
 */
function findProvinceRegionSpecs(text: string): RegionSpec[] {
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
    specs.push(...result.specs);
    cursor = result.consumedUntil;
  }
  return specs;
}

/**
 * Resolves every lone city/county/district mention (no province anywhere in
 * the text) that sits near a residence-signal occurrence and isn't an
 * institution-name false positive ("이천시청"). All-or-nothing per token: an
 * unrecognized or genuinely cross-province-ambiguous city name (e.g.
 * 고성군, 중구) marks the whole clause unresolved rather than silently
 * dropping just that one entry from an OR'd list.
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
    // A 2-character match came from the short-district whitelist branch —
    // reject it if it's not at a real word boundary (e.g. the "동구" inside
    // "노동구제" is a substring collision, not a genuine district mention),
    // same safety check applied to province aliases. This is noise, not an
    // unresolvable-but-real signal, so it's silently skipped rather than
    // flagged via `hadUnresolvableToken`.
    if (token.length === 2 && !isHangulBoundaryOk(text, idx)) continue;
    if (isInstitutionMention(text, idx + token.length)) continue;
    if (!isNearAnyIndex(idx, token.length, signalIndices)) continue;

    const provinces = resolveCityProvinces(token);
    if (provinces.length === 1) {
      const key = `${provinces[0]}|${token}`;
      if (!seen.has(key)) {
        seen.add(key);
        specs.push({ province: provinces[0], city: token });
      }
    } else {
      hadUnresolvableToken = true;
    }
  }

  return { specs, hadUnresolvableToken };
}

function parseRegionClause(text: string): { rule?: EligibilityRule; unresolved?: string } | undefined {
  if (!hasResidenceSignal(text)) return undefined;

  const provinceSpecs = findProvinceRegionSpecs(text);
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
  // A real geographic signal exists (an unresolved/ambiguous city token, or
  // some city-like token we couldn't safely place) but we can't turn it into
  // a rule — report it rather than silently dropping it.
  if (hadUnresolvableToken || CITY_TOKEN_COMBINED_RE.test(text)) return { unresolved: text };
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
