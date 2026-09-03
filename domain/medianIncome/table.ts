/**
 * Versioned 기준중위소득 (Korean "standard median income") static table.
 *
 * Every welfare program that references "기준중위소득 N%" means a specific,
 * annually-republished KRW figure per household size, published by MOHW
 * (보건복지부) after 중앙생활보장위원회 (Central Living Security Committee)
 * deliberation — NOT a literal statistical median that could be computed at
 * request time. There is no formula that derives one year's table from
 * another (each year's committee sets its own increase, and the increase
 * rate is NOT uniform across household sizes — e.g. the widely-reported 2027
 * "6.70%" headline rate is the 4-person figure only; verify against this
 * comment's sources rather than assuming a single scalar multiplier
 * reproduces every household size). So this table is deliberately DATA, not
 * a computed series, and every entry carries its own provenance.
 *
 * `householdValues` are MONTHLY amounts in KRW, 100% of 기준중위소득, for
 * household sizes 1–7 — the only sizes MOHW publishes directly. 8+ person
 * households are computed from `eightPlusFormula` (see
 * `getMedianIncomeMonthlyAmount` below) when that year's per-person
 * increment has been verified; otherwise 8+ households resolve to
 * `undefined` (unknown) rather than being guessed.
 *
 * `status`:
 *  - "verified": every household-size figure (1–7) confirmed against an
 *    official or independently-corroborated source at authoring time.
 *  - "announced": the Committee has decided the figures (so they ARE the
 *    real future-effective numbers, not a projection) but the formal MOHW
 *    고시 gazette text was not independently reachable at authoring time for
 *    every field — see per-entry notes.
 *  - "partial": some household sizes (and/or the 8+ formula) could not be
 *    confirmed from any source at authoring time and are left `undefined`.
 *    Never backfilled by applying a headline percentage to a sibling size.
 */

export interface MedianIncomeYearEntry {
  year: number;
  /** `YYYY-MM-DD`; the calendar date this year's table becomes the "policy current" table (see `resolvePolicyCurrentMedianIncomeYear`). MOHW tables take effect January 1 of their named year. */
  effectiveFrom: string;
  /** Monthly KRW, 100% of 기준중위소득, keyed by household size 1–7. A missing key means that size's figure could not be verified (see module docstring) — never backfilled. */
  householdValues: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>>;
  /**
   * 8인 이상 가구 산정: MOHW's consistent published rule is "7인 가구 금액에,
   * 가구원 1인 증가마다 6인과 7인 가구 금액의 차액을 더한다" (add the 6-to-7-person
   * delta once per additional person beyond 7). Only populated when both the
   * 6-person and 7-person figures for this year are independently verified
   * AND the resulting per-person increment has been corroborated — never
   * derived speculatively.
   */
  eightPlusFormula?: {
    /** KRW added per household member beyond 7 (== householdValues[7] - householdValues[6] for a verified year). */
    perPersonIncrementKrw: number;
  };
  sourceUrl?: string;
  /** Committee decision date or gazette publication date, `YYYY-MM-DD`, when known. */
  publishedAt?: string;
  status: "verified" | "announced" | "partial";
  /** Free-text provenance note — which committee session, corroborating sources, and any caveats. */
  note?: string;
}

export const MEDIAN_INCOME_TABLE: readonly MedianIncomeYearEntry[] = [
  {
    year: 2021,
    effectiveFrom: "2021-01-01",
    householdValues: { 1: 1827831, 2: 3088079, 3: 3983950, 4: 4876290, 5: 5757373, 6: 6628603, 7: 7497198 },
    eightPlusFormula: { perPersonIncrementKrw: 7497198 - 6628603 },
    sourceUrl: "https://www.mohw.go.kr/menu.es?mid=a10708010900",
    status: "verified",
    note:
      "2021년도 기준 중위소득 (보건복지부 고시). 1~7인 전 가구원수를 mohw.go.kr 공식 " +
      "'연도별 기준중위소득' 페이지에서 직접 확인함 (checkpoint-4 provenance pass, 2026-09).",
  },
  {
    year: 2022,
    effectiveFrom: "2022-01-01",
    householdValues: { 1: 1944812, 2: 3260085, 3: 4194701, 4: 5121080, 5: 6024515, 6: 6907004, 7: 7780592 },
    eightPlusFormula: { perPersonIncrementKrw: 7780592 - 6907004 },
    sourceUrl: "https://www.mohw.go.kr/menu.es?mid=a10708010900",
    status: "verified",
    note:
      "2022년도 기준 중위소득 (보건복지부 고시). 1~7인 전 가구원수를 mohw.go.kr 공식 " +
      "'연도별 기준중위소득' 페이지에서 직접 확인함 (checkpoint-4 provenance pass, 2026-09).",
  },
  {
    year: 2023,
    effectiveFrom: "2023-01-01",
    householdValues: { 1: 2077892, 2: 3456155, 3: 4434816, 4: 5400964, 5: 6330688, 6: 7227981, 7: 8107515 },
    eightPlusFormula: { perPersonIncrementKrw: 8107515 - 7227981 },
    sourceUrl: "https://www.mohw.go.kr/menu.es?mid=a10708010900",
    status: "verified",
    note:
      "2023년도 기준 중위소득 (보건복지부 고시). 1~7인 전 가구원수를 mohw.go.kr 공식 " +
      "'연도별 기준중위소득' 페이지에서 직접 확인함 (checkpoint-4 provenance pass, 2026-09).",
  },
  {
    year: 2024,
    effectiveFrom: "2024-01-01",
    householdValues: { 1: 2228445, 2: 3682609, 3: 4714657, 4: 5729913, 5: 6695735, 6: 7618369, 7: 8514994 },
    eightPlusFormula: { perPersonIncrementKrw: 8514994 - 7618369 },
    sourceUrl: "https://www.mohw.go.kr/menu.es?mid=a10708010900",
    status: "verified",
    note:
      "2024년도 기준 중위소득 (보건복지부 고시). 1~7인 전 가구원수를 mohw.go.kr 공식 " +
      "'연도별 기준중위소득' 페이지에서 직접 확인함 (checkpoint-4 provenance pass, 2026-09).",
  },
  {
    year: 2025,
    effectiveFrom: "2025-01-01",
    householdValues: { 1: 2392013, 2: 3932658, 3: 5025353, 4: 6097773, 5: 7108192, 6: 8064805, 7: 8988428 },
    eightPlusFormula: { perPersonIncrementKrw: 8988428 - 8064805 },
    sourceUrl: "https://www.mohw.go.kr/menu.es?mid=a10708010900",
    status: "verified",
    note:
      "2025년도 기준 중위소득 (보건복지부 고시). 1~7인 전 가구원수를 mohw.go.kr 공식 " +
      "'연도별 기준중위소득' 페이지에서 직접 확인함 (checkpoint-4 provenance pass, 2026-09).",
  },
  {
    year: 2026,
    effectiveFrom: "2026-01-01",
    householdValues: { 1: 2564238, 2: 4199292, 3: 5359036, 4: 6494738, 5: 7556719, 6: 8555952, 7: 9515150 },
    eightPlusFormula: { perPersonIncrementKrw: 9515150 - 8555952 },
    sourceUrl: "https://www.mohw.go.kr/menu.es?mid=a10708010900",
    status: "verified",
    note:
      "2026년도 기준 중위소득 (보건복지부 고시 제2025-135호, 시행 2026-01-01). 1~7인 전 가구원수를 " +
      "mohw.go.kr 공식 '연도별 기준중위소득' 페이지에서 직접 확인함 (6.51% 인상, 역대 최대; " +
      "재확인: checkpoint-4 provenance pass, 2026-09).",
  },
  {
    year: 2027,
    effectiveFrom: "2027-01-01",
    // 1~6인만 확인됨. 7인 가구 금액은 조사 시점(2026-09)에 어떤 정부 소스에서도
    // 확인하지 못해 UNKNOWN으로 남김 — 6.70% 인상률은 4인 가구 헤드라인 수치일 뿐이고
    // 가구원수별로 인상률이 다르므로 6인 값에 일률적으로 곱해 7인 값을 추정하지 않음.
    // eightPlusFormula 역시 7인 값 없이는 검증 불가하므로 생략. mohw.go.kr의 공식
    // '연도별 기준중위소득' 요약 페이지(위 2021-2026 entries의 sourceUrl)는 조사 시점
    // 기준 아직 2027 행을 추가하지 않은 상태였다 (2026년까지만 게시) — 그 페이지가
    // 갱신되면 7인 값과 함께 재검증할 것.
    householdValues: { 1: 2736042, 2: 4480645, 3: 5718091, 4: 6929885, 5: 8063019, 6: 9129201 },
    sourceUrl: "https://www.korea.kr/news/policyNewsView.do?newsId=148968956",
    publishedAt: "2026-07-28",
    status: "partial",
    note:
      "2026-07-28 제80차 중앙생활보장위원회 심의·의결로 확정 (4인 가구 기준 6.70% 인상, " +
      "제도 도입 이후 역대 최대 — 종전 최고치였던 2026년도 6.51%를 재차 경신). 1인(2,736,042원) " +
      "과 4인(6,929,885원) 가구 금액은 대한민국 정책브리핑(korea.kr, 문화체육관광부 국민소통실 " +
      "운영 정부 포털 — 정부 보도자료를 직접 게재)에서 명시적으로 확인함; 나머지 2·3·5·6인 " +
      "가구 금액은 beminor.com(비마이너, 스스로 '보건복지부 보도자료'를 출처로 명시) 보도값과 " +
      "일치하며 이 값들은 정부 공식 sourceUrl에서 직접 재확인되지 않았음 — status가 " +
      "'announced'가 아니라 'partial'로 남아있는 이유. 7인 가구 금액 및 8인 이상 산정식은 " +
      "조사 시점(2026-09) 기준 어떤 소스에서도 확인되지 않아 UNKNOWN으로 유지 — mohw.go.kr의 " +
      "공식 '연도별 기준중위소득' 페이지(2021-2026 entries가 가리키는 sourceUrl)가 2027 행으로 " +
      "갱신되면 전체를 재검증할 것.",
  },
];

/** Sorted descending by `effectiveFrom` — computed once at module load. */
const TABLE_BY_EFFECTIVE_DESC = [...MEDIAN_INCOME_TABLE].sort((a, b) =>
  a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0
);

/**
 * The table year whose data applies to a given instant ("기준 연도"), i.e.
 * the most recent year whose `effectiveFrom` is on/before the policy
 * calendar date of `todayPolicyDateString`. Returns `undefined` if the
 * instant predates every table entry (never a guess/extrapolation).
 *
 * Deliberately takes an already-computed `todayPolicyDateString` (see
 * lib/dates/policyDate.ts's `policyDateString`) rather than a `Date`, so
 * every caller resolves "today" through the single Asia/Seoul policy
 * calendar rather than each reimplementing that call — mirrors
 * `compareMarriageDurationToThreshold`'s reference-date-string convention.
 */
export function resolvePolicyCurrentMedianIncomeYear(todayPolicyDateString: string): number | undefined {
  const entry = TABLE_BY_EFFECTIVE_DESC.find((e) => e.effectiveFrom <= todayPolicyDateString);
  return entry?.year;
}

function getYearEntry(year: number): MedianIncomeYearEntry | undefined {
  return MEDIAN_INCOME_TABLE.find((e) => e.year === year);
}

/**
 * Monthly KRW, 100% of 기준중위소득, for a given year and household size.
 * Returns `undefined` (never a guess) when: the year isn't in the table, the
 * requested household size's figure wasn't verified for that year, or
 * `householdSize > 7` and that year's 8+ formula isn't verified.
 */
export function getMedianIncomeMonthlyAmount(year: number, householdSize: number): number | undefined {
  if (!Number.isInteger(householdSize) || householdSize < 1) return undefined;
  const entry = getYearEntry(year);
  if (!entry) return undefined;

  if (householdSize <= 7) {
    return entry.householdValues[householdSize as 1 | 2 | 3 | 4 | 5 | 6 | 7];
  }

  const base = entry.householdValues[7];
  if (base === undefined || !entry.eightPlusFormula) return undefined;
  return base + (householdSize - 7) * entry.eightPlusFormula.perPersonIncrementKrw;
}
