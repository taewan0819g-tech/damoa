/**
 * Hand-reviewed, stratified gold sample for MOIS-style 지원대상/선정기준 free
 * text containing geographic terms. Each entry's `text` is a representative
 * excerpt authored to match real MOIS phrasing patterns observed during the
 * eligibility-coverage audit (scripts/auditEligibilityCoverage.ts) — NOT a
 * verbatim copy of any live API response, and contains no secrets/keys.
 *
 * This is a regression fixture: every entry's `expected` outcome was decided
 * by manual review at the time it was added. If a future change to
 * `parseRegionClause` (lib/eligibility/extraction/koreanEligibilityParser.ts)
 * flips any of these, that's a signal the extractor got more aggressive
 * (or more conservative) in a way that needs a human look — see
 * __tests__/eligibility/regionGoldSample.test.ts.
 */

export type RegionGoldExpectation =
  /** A single, specific region_in rule value is expected. */
  | { outcome: "rule"; value: { province: string; city?: string }[] }
  /** No region rule AND no unresolved-clause entry (no real geographic signal, or an explicitly nationwide claim). */
  | { outcome: "no_rule" }
  /** A real geographic/residence signal exists but must NOT resolve to a specific rule. */
  | { outcome: "unresolved" };

export interface RegionGoldSample {
  id: string;
  text: string;
  expectation: RegionGoldExpectation;
  note: string;
}

export const REGION_GOLD_SAMPLES: RegionGoldSample[] = [
  // -- Province-only residence -------------------------------------------------
  {
    id: "province-only-full-name",
    text: "서울특별시 거주자만 신청 가능합니다.",
    expectation: { outcome: "rule", value: [{ province: "서울특별시" }] },
    note: "Full official province name + 거주자.",
  },
  {
    id: "province-only-common-alias",
    text: "경기도에 거주하는 청년을 대상으로 합니다.",
    expectation: { outcome: "rule", value: [{ province: "경기도" }] },
    note: "Common alias form, 거주하는 청년 phrasing.",
  },

  // -- City-only residence resolved through the gazetteer -----------------------
  {
    id: "city-only-icheon",
    text: "이천시 거주자만 신청 가능",
    expectation: { outcome: "rule", value: [{ province: "경기도", city: "이천시" }] },
    note: "Task spec's canonical example: lone city, resolved via gazetteer.",
  },
  {
    id: "city-only-gangnam-gu",
    text: "강남구 주민등록을 두고 있는 자",
    expectation: { outcome: "rule", value: [{ province: "서울특별시", city: "강남구" }] },
    note: "주민등록 (not 거주) as the residence signal.",
  },
  {
    id: "city-only-haeundae",
    text: "해운대구에 주소지를 둔 주민",
    expectation: { outcome: "rule", value: [{ province: "부산광역시", city: "해운대구" }] },
    note: "Regression guard for the 대구/해운대구 substring collision.",
  },

  // -- Province + city together -------------------------------------------------
  {
    id: "province-and-city",
    text: "경기도 성남시 거주자에 한함",
    expectation: { outcome: "rule", value: [{ province: "경기도", city: "성남시" }] },
    note: "Direct province+city adjacency.",
  },
  {
    id: "province-and-city-suwon",
    text: "경기도 수원시 주민등록상 거주자",
    expectation: { outcome: "rule", value: [{ province: "경기도", city: "수원시" }] },
    note: "주민등록상 phrasing variant.",
  },

  // -- District + metropolitan city ---------------------------------------------
  {
    id: "district-plus-metro",
    text: "부산광역시 해운대구에 거주하는 자만 신청 가능",
    expectation: { outcome: "rule", value: [{ province: "부산광역시", city: "해운대구" }] },
    note: "Metro + district, explicit form.",
  },

  // -- Aliases --------------------------------------------------------------------
  {
    id: "alias-gyeonggi-short",
    text: "경기 이천시 거주 청년",
    expectation: { outcome: "rule", value: [{ province: "경기도", city: "이천시" }] },
    note: "Short alias 경기 -> 경기도, from the task spec.",
  },
  {
    id: "alias-sejong",
    text: "세종시 거주자를 대상으로 함",
    expectation: { outcome: "rule", value: [{ province: "세종특별자치시" }] },
    note: "세종시 alias -> 세종특별자치시.",
  },

  // -- Multiple allowed regions ---------------------------------------------------
  {
    id: "multi-region-province-or",
    text: "서울특별시 또는 경기도 거주자만 신청 가능",
    expectation: { outcome: "rule", value: [{ province: "서울특별시" }, { province: "경기도" }] },
    note: "OR'd province list.",
  },
  {
    id: "multi-region-sibling-cities",
    text: "경기도 이천시, 여주시 거주자만 신청 가능",
    expectation: {
      outcome: "rule",
      value: [
        { province: "경기도", city: "이천시" },
        { province: "경기도", city: "여주시" },
      ],
    },
    note: "Comma-delimited sibling cities under one province.",
  },

  // -- Nationwide / general cases ---------------------------------------------------
  {
    id: "nationwide-explicit",
    text: "전국 거주자 누구나 신청할 수 있습니다.",
    expectation: { outcome: "no_rule" },
    note: "Explicitly nationwide — no region constraint at all.",
  },
  {
    id: "nationwide-deictic-no-anchor",
    text: "관내 거주자를 대상으로 사업을 시행합니다.",
    expectation: { outcome: "unresolved" },
    note: "'관내' is a genuine deictic residence phrase (same class as '도내'/'우리 시') asserting residence within SOME specific, unstated jurisdiction — not a generic nationwide claim. With no province/city named anywhere else in the field to anchor it to, Section 4 correctly reports this as unresolved (a real geographic restriction exists but can't be safely placed) rather than silently treating the policy as unrestricted nationwide.",
  },

  // -- Organization/location mentions that are NOT residence conditions -----------
  {
    id: "org-mention-office",
    text: "이천시청에서 지원하는 사업입니다.",
    expectation: { outcome: "no_rule" },
    note: "이천시청 = the city government office, not a residence requirement; no residence keyword present.",
  },
  {
    id: "org-mention-implementation",
    text: "이천시에서 사업 시행",
    expectation: { outcome: "no_rule" },
    note: "Implementing-agency mention, no residence keyword.",
  },
  {
    id: "org-mention-reception",
    text: "접수처: 이천시청",
    expectation: { outcome: "no_rule" },
    note: "Reception office address, not eligibility text.",
  },
  {
    id: "org-mention-with-nearby-real-clause",
    text: "이천시 거주자만 신청 가능하며, 접수처는 이천시청입니다.",
    expectation: { outcome: "rule", value: [{ province: "경기도", city: "이천시" }] },
    note: "Combined case: a real residence clause plus an unrelated institution mention in the same text; only the residence clause should resolve.",
  },

  // -- Ambiguous text stays unresolved ---------------------------------------------
  {
    id: "ambiguous-cross-province-city",
    text: "고성군 거주자만 신청 가능",
    expectation: { outcome: "unresolved" },
    note: "고성군 exists in both 강원특별자치도 and 경상남도 — genuinely ambiguous, must not guess.",
  },
  {
    id: "ambiguous-unrecognized-city-token",
    text: "없는시 거주자만 신청 가능",
    expectation: { outcome: "unresolved" },
    note: "Not a real gazetteer entry — reported, not guessed.",
  },
  {
    id: "ambiguous-gangseo-gu",
    text: "강서구 거주자만 신청 가능",
    expectation: { outcome: "unresolved" },
    note: "강서구 exists in both 서울특별시 and 부산광역시 — genuinely ambiguous, must not guess.",
  },

  // -- User-city compatible with a broader province policy / city conflict --------
  // (These two don't exercise the extractor directly — they exercise
  // matchRegion's hierarchy semantics against extractor output — kept here
  // for completeness of the stratified sample per the task's requirement.)
  {
    id: "hierarchy-broad-province-rule",
    text: "경기도 거주자만 신청 가능",
    expectation: { outcome: "rule", value: [{ province: "경기도" }] },
    note: "Province-only rule; a 경기도/이천시 resident should PASS this via matchRegion (see regionGoldSample.test.ts).",
  },
];
