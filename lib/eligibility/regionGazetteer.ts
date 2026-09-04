/**
 * Canonical, deterministic Korean administrative-region gazetteers.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO SEPARATE TABLES (Checkpoint: Corrective Region Architecture)
 * ---------------------------------------------------------------------------
 * A single "CITY_GAZETTEER" used to serve two fundamentally different jobs:
 *
 *  (A) telling a NEW user what province/city they can currently select
 *      (onboarding, profile page) — this must reflect TODAY's legal roster,
 *      and must NEVER offer an administrative unit that no longer exists.
 *
 *  (B) letting the eligibility text parser (koreanEligibilityParser.ts)
 *      recognize a region mention inside raw MOIS/Youth benefit text — this
 *      text spans years of catalog ingestion and legitimately contains BOTH
 *      historical names (from before an administrative change) AND current
 *      names (from freshly-ingested/updated records) for the exact same
 *      real-world place. Deleting a historical name to "clean up" (A) would
 *      silently break parsing of policy text that still uses it.
 *
 * These two jobs must never share one mutable source of truth again — a
 * change motivated by (A) (e.g. removing an abolished district a user could
 * pick) must not silently break (B) (recognizing that same district name in
 * old policy text), and vice versa. See:
 *
 *   - `CURRENT_RESIDENCE_GAZETTEER` / `getCitiesForProvince` — job (A).
 *   - `POLICY_REGION_GAZETTEER` / `getGazetteer`, `resolveCityProvinces`,
 *     `isUnambiguousCity`, `getShortDistrictNames` — job (B).
 *
 * Both are still hand-curated (see the two METADATA consts below) and both
 * are exact-match-only — neither ever fuzzy-matches or guesses.
 *
 * A handful of city/county/district names exist in more than one province
 * (Korea has no nationwide-unique-name guarantee at this administrative
 * level). Those are listed under every province they really belong to;
 * `resolveCityProvinces` returns all of them and callers MUST treat 2+
 * results as unresolved rather than picking one. Known collisions in this
 * dataset: 고성군 (강원특별자치도 / 경상남도), 중구 (서울/부산/대구/인천/대전),
 * 동구 (부산/대구/인천/광주/대전/울산), 서구 (부산/대구/인천/광주/대전),
 * 남구 (부산/대구/광주/울산), 북구 (부산/대구/광주/울산), 강서구 (서울/부산).
 *
 * ---------------------------------------------------------------------------
 * 2026-07-01 VERIFIED ADMINISTRATIVE CHANGES (see
 * docs/audits/region-gazetteer-freshness.json for full sourcing, and
 * docs/audits/region-transition-candidate-diff.json for the reviewed effect
 * on the frozen benefit catalog's extracted region rules):
 *
 *  1. 광주광역시 + 전라남도 merged into a single 광역자치단체,
 *     "전남광주통합특별시" — 「전남광주통합특별시 설치를 위한 특별법」,
 *     법률 제21446호, 공포 2026-03-05, 시행 2026-07-01.
 *     https://www.law.go.kr/lsInfoP.do?lsiSeq=284111&viewCls=lsRvsDocInfoR
 *
 *  2. 인천광역시 abolished 중구/동구 and created 제물포구 (inland 중구+동구),
 *     영종구 (영종도, the island part of former 중구), and 검단구 (검단
 *     New Town area, split off former 서구) — 「인천광역시 제물포구ㆍ영종구 및
 *     검단구 설치 등에 관한 법률」, 시행 2026-07-01.
 *     https://www.law.go.kr/lsInfoP.do?lsiSeq=281877&viewCls=lsRvsDocInfoR
 *
 *  3. 인천광역시 서구 (the portion NOT split into 검단구) renamed to
 *     서해구 — 「인천광역시 서구 명칭 변경에 관한 법률」, 법률 제21734호,
 *     시행 2026-07-01.
 *
 * `CURRENT_RESIDENCE_GAZETTEER` reflects these changes: it no longer offers
 * 광주광역시/전라남도/인천 중구/동구/서구 as new-user-selectable. But
 * `POLICY_REGION_GAZETTEER` (job B) KEEPS every historical name it already
 * recognized (광주광역시, 전라남도, 인천 중구/동구/서구 all still resolve to
 * their real, unchanged parent province) AND gains the new current names
 * (전남광주통합특별시 as a recognized province; 인천 제물포구/영종구/검단구/
 * 서해구 as recognized cities under the still-unchanged 인천광역시 province)
 * — see the per-entry comments below for exactly what was and wasn't added,
 * and why.
 *
 * IMPORTANT — deliberately NOT done, and why (see "matching safety" in the
 * checkpoint spec): old and new names are never aliased to each other.
 * 중구/동구/서구 are NOT treated as equivalent to 제물포구/영종구/검단구/서해구
 * (their boundaries were split, not renamed 1:1 — a resident of old 중구 is
 * provably a resident of EITHER new 제물포구 OR new 영종구, and which one
 * cannot be determined from a city name alone). Similarly, 광주광역시 and
 * 전라남도 are NOT aliased to 전남광주통합특별시 in `PROVINCE_ALIASES`
 * (region.ts): even though every inch of the old provinces' territory is now
 * inside the new one (a lossless merge, unlike Incheon's split), whether an
 * old province-specific PROGRAM's eligibility legally extends to the whole
 * new entity is a policy question this codebase cannot answer from
 * geography alone. Both tables simply keep old and new names as fully
 * separate, independently-resolvable entries — never guessing a bridge
 * between them. This means a NEW user (who can only ever select current
 * names) will get a deterministic, non-guessed "fail" against a region rule
 * still expressed in old-name form, and a benefit newly expressed with a
 * current name will correctly match a new user's current-name residence.
 * See docs/audits/region-transition-candidate-diff.json for exactly which
 * frozen-catalog records this changed, and why each change was expected.
 * ---------------------------------------------------------------------------
 */

/** Districts unaffected by the 2026-07-01 Incheon reorganization. */
const INCHEON_UNAFFECTED_DISTRICTS = ["미추홀구", "연수구", "남동구", "부평구", "계양구", "강화군", "옹진군"];
/** Abolished 2026-07-01 — kept in POLICY_REGION_GAZETTEER only (historical text), never in CURRENT_RESIDENCE_GAZETTEER. */
const INCHEON_HISTORICAL_DISTRICTS = ["중구", "동구", "서구"];
/** Created/renamed-into 2026-07-01 — the only Incheon sub-units a new user may select. */
const INCHEON_CURRENT_DISTRICTS = ["제물포구", "영종구", "검단구", "서해구"];

/** 광주광역시's 5 자치구 — unchanged by the merger, still real places under the new province name. */
const GWANGJU_DISTRICTS = ["동구", "서구", "남구", "북구", "광산구"];
/** 전라남도's 22 시/군 — unchanged by the merger, still real places under the new province name. */
const JEONNAM_CITIES = [
  "목포시", "여수시", "순천시", "나주시", "광양시",
  "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군",
  "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군",
  "신안군",
];

/**
 * Job (A): what a NEW user can currently select for province/city in
 * onboarding/profile. Reflects the legally current roster as of the dates
 * in `CURRENT_RESIDENCE_GAZETTEER_METADATA` below — read via
 * `getCitiesForProvince`, never imported directly.
 */
const CURRENT_RESIDENCE_GAZETTEER: Record<string, string[]> = {
  "서울특별시": [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구",
    "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구",
    "구로구", "금천구", "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구",
    "강동구",
  ],
  "부산광역시": [
    "중구", "서구", "동구", "영도구", "부산진구", "동래구", "남구", "북구",
    "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군",
  ],
  "대구광역시": [
    "중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군",
  ],
  "인천광역시": [...INCHEON_CURRENT_DISTRICTS, ...INCHEON_UNAFFECTED_DISTRICTS],
  "전남광주통합특별시": [...GWANGJU_DISTRICTS, ...JEONNAM_CITIES],
  "대전광역시": ["동구", "중구", "서구", "유성구", "대덕구"],
  "울산광역시": ["중구", "남구", "동구", "북구", "울주군"],
  "세종특별자치시": [],
  "경기도": [
    "수원시", "성남시", "의정부시", "안양시", "부천시", "광명시", "평택시",
    "동두천시", "안산시", "고양시", "과천시", "구리시", "남양주시", "오산시",
    "시흥시", "군포시", "의왕시", "하남시", "용인시", "파주시", "이천시",
    "안성시", "김포시", "화성시", "광주시", "양주시", "포천시", "여주시",
    "연천군", "가평군", "양평군",
  ],
  "강원특별자치도": [
    "춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시",
    "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군",
    "양구군", "인제군", "고성군", "양양군",
  ],
  "충청북도": [
    "청주시", "충주시", "제천시",
    "보은군", "옥천군", "영동군", "증평군", "진천군", "괴산군", "음성군", "단양군",
  ],
  "충청남도": [
    "천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시",
    "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군",
  ],
  "전북특별자치도": [
    "전주시", "군산시", "익산시", "정읍시", "남원시", "김제시",
    "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군",
  ],
  "경상북도": [
    "포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시",
    "상주시", "문경시", "경산시",
    "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군", "성주군",
    "칠곡군", "예천군", "봉화군", "울진군", "울릉군",
  ],
  "경상남도": [
    "창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시",
    "의령군", "함안군", "창녕군", "고성군", "남해군", "하동군", "산청군",
    "함양군", "거창군", "합천군",
  ],
  "제주특별자치도": ["제주시", "서귀포시"],
};

/**
 * Machine-readable provenance for `CURRENT_RESIDENCE_GAZETTEER`.
 * `authoritative: false` because this is still a hand-transcribed table, not
 * fetched live from a government API — but every 2026-07-01 change it
 * reflects has been individually checked against 국가법령정보센터 (law.go.kr).
 */
export const CURRENT_RESIDENCE_GAZETTEER_METADATA = {
  version: "2026-07-jeonnam-gwangju-incheon.1",
  effectiveAsOf: "2026-07-01",
  sourceType: "manual" as const,
  source:
    "Hand-transcribed standard 시/군/구 roster, individually verified against 국가법령정보센터 (law.go.kr) for the 2026-07-01 전남광주통합특별시 merger and 인천 구제 개편. Not fetched from a live API.",
  authoritative: false,
  verifiedLegalChanges: [
    {
      law: "전남광주통합특별시 설치를 위한 특별법",
      lawNumber: "법률 제21446호",
      promulgatedDate: "2026-03-05",
      effectiveDate: "2026-07-01",
      url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=284111&viewCls=lsRvsDocInfoR",
      change: "광주광역시 + 전라남도 -> 전남광주통합특별시 (단일 광역자치단체로 통합)",
    },
    {
      law: "인천광역시 제물포구ㆍ영종구 및 검단구 설치 등에 관한 법률",
      lawNumber: null,
      promulgatedDate: null,
      effectiveDate: "2026-07-01",
      url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=281877&viewCls=lsRvsDocInfoR",
      change: "인천광역시 중구+동구 폐지 -> 제물포구 신설; 중구 영종도 지역 -> 영종구 신설; 서구 일부(검단 신도시) -> 검단구 신설",
      note: "Independent lookups for this law's exact 법률 번호/공포일 returned inconsistent values (법률 제20161호/2024-01-30 vs 법률 제21247호/2025-12-30) — recorded here as unresolved rather than guessed. The 2026-07-01 effective date and the district-establishment substance are independently corroborated by multiple sources including the law.go.kr detail page itself.",
    },
    {
      law: "인천광역시 서구 명칭 변경에 관한 법률",
      lawNumber: "법률 제21734호",
      promulgatedDate: null,
      effectiveDate: "2026-07-01",
      url: null,
      change: "인천광역시 서구(검단구로 분리된 부분 제외) -> 서해구로 명칭 변경",
    },
  ],
  candidateAuthoritativeSources: [
    {
      name: "국가법령정보센터 (law.go.kr)",
      url: "https://www.law.go.kr/",
      note: "System of record for the three verified 2026-07-01 laws above.",
    },
    {
      name: "행정안전부_행정표준코드_법정동코드 (data.go.kr OpenAPI)",
      url: "https://www.data.go.kr/data/15077871/openapi.do",
      note: "Row-level 시도명/시군구명/법정동코드 fields; requires data.go.kr API key registration. Candidate source for a future fully-automated regeneration of both gazetteers.",
    },
  ],
} as const;

/**
 * Job (B): what the eligibility text parser (koreanEligibilityParser.ts)
 * recognizes when scanning raw MOIS/Youth benefit text for a region mention.
 * Deliberately broader than `CURRENT_RESIDENCE_GAZETTEER` — keeps every
 * historical name job (A) no longer offers, so parsing of older catalog
 * text never regresses, and separately gains the new 2026-07-01 names the
 * frozen catalog already uses in some records. Read via `getGazetteer`,
 * `resolveCityProvinces`, `isUnambiguousCity`, `getShortDistrictNames` —
 * never imported directly.
 */
const POLICY_REGION_GAZETTEER: Record<string, string[]> = {
  "서울특별시": [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구",
    "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구",
    "구로구", "금천구", "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구",
    "강동구",
  ],
  "부산광역시": [
    "중구", "서구", "동구", "영도구", "부산진구", "동래구", "남구", "북구",
    "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군",
  ],
  "대구광역시": [
    "중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군",
  ],
  // Both eras coexist: 인천광역시 itself was never renamed/merged, only some
  // of its internal district boundaries were redrawn 2026-07-01. Old and new
  // names are listed side by side, never aliased to each other (see file
  // header — 중구/동구 -> {제물포구, 영종구} and 서구 -> {검단구, 서해구} are
  // splits, not 1:1 renames, so no automatic equivalence is asserted).
  "인천광역시": [
    ...INCHEON_HISTORICAL_DISTRICTS,
    ...INCHEON_CURRENT_DISTRICTS,
    ...INCHEON_UNAFFECTED_DISTRICTS,
  ],
  // Kept exactly as before the 2026-07-01 merger, for historical policy text
  // that still says "광주광역시"/"전라남도". Deliberately does NOT also gain
  // a duplicate "전남광주통합특별시" entry with the same city list — doing so
  // would make every lone mention of a 전남/광주 city (e.g. a bare "목포시
  // 거주자" with no province prefix) newly AMBIGUOUS between the old and new
  // province name, regressing today's unambiguous resolution for the vast
  // majority of 전남/광주 catalog text that has nothing to do with this
  // checkpoint. "전남광주통합특별시" is still a fully recognized PROVINCE name
  // (see region.ts's PROVINCE_ALIASES) — an explicit "전남광주통합특별시 XXX"
  // mention in text resolves via the province-first path and safely falls
  // back to a province-only spec (see koreanEligibilityParser.ts's
  // `resolveCitySpec`) rather than asserting a city match this table doesn't
  // contain.
  "광주광역시": GWANGJU_DISTRICTS,
  "전라남도": JEONNAM_CITIES,
  "대전광역시": ["동구", "중구", "서구", "유성구", "대덕구"],
  "울산광역시": ["중구", "남구", "동구", "북구", "울주군"],
  "세종특별자치시": [],
  "경기도": [
    "수원시", "성남시", "의정부시", "안양시", "부천시", "광명시", "평택시",
    "동두천시", "안산시", "고양시", "과천시", "구리시", "남양주시", "오산시",
    "시흥시", "군포시", "의왕시", "하남시", "용인시", "파주시", "이천시",
    "안성시", "김포시", "화성시", "광주시", "양주시", "포천시", "여주시",
    "연천군", "가평군", "양평군",
  ],
  "강원특별자치도": [
    "춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시",
    "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군",
    "양구군", "인제군", "고성군", "양양군",
  ],
  "충청북도": [
    "청주시", "충주시", "제천시",
    "보은군", "옥천군", "영동군", "증평군", "진천군", "괴산군", "음성군", "단양군",
  ],
  "충청남도": [
    "천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시",
    "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군",
  ],
  "전북특별자치도": [
    "전주시", "군산시", "익산시", "정읍시", "남원시", "김제시",
    "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군",
  ],
  "경상북도": [
    "포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시",
    "상주시", "문경시", "경산시",
    "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군", "성주군",
    "칠곡군", "예천군", "봉화군", "울진군", "울릉군",
  ],
  "경상남도": [
    "창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시",
    "의령군", "함안군", "창녕군", "고성군", "남해군", "하동군", "산청군",
    "함양군", "거창군", "합천군",
  ],
  "제주특별자치도": ["제주시", "서귀포시"],
};

/**
 * Machine-readable provenance for this static dataset. Bump `version` any
 * time `POLICY_REGION_GAZETTEER` changes (an added/removed/renamed 시/군/구, a
 * province transfer like the 2023 군위군 move). `authoritative: false` is
 * load-bearing documentation: this table is a hand-curated approximation of
 * the real administrative roster, good enough for the parser's safety-net
 * use case (never assert a wrong region, fall back to unresolved when
 * unsure) but NOT a substitute for the government's own code table if this
 * data is ever needed for a purpose that requires legal precision.
 */
export const GAZETTEER_METADATA = {
  version: "2026-07-incheon-jeonnam-gwangju-historical-plus-current.1",
  effectiveAsOf: "2023-07-01", // 군위군 경상북도 -> 대구광역시 transfer date; this table is a superset spanning multiple eras, not pinned to one date
  sourceType: "manual" as const,
  source:
    "Hand-transcribed from standard 시/군/구 (기초자치단체) rosters; cross-checked against known per-province city/county/district counts. Not fetched from a live API. Deliberately retains historical names alongside current ones — see file header.",
  authoritative: false,
  candidateAuthoritativeSources: [
    {
      name: "행정안전부_행정표준코드_법정동코드 (data.go.kr OpenAPI)",
      url: "https://www.data.go.kr/data/15077871/openapi.do",
      note: "Row-level 시도명/시군구명/법정동코드 fields; requires data.go.kr API key registration.",
    },
    {
      name: "행정안전부_행정표준코드_전체코드_다운로드 (data.go.kr file download)",
      url: "https://www.data.go.kr/data/15092039/fileData.do",
      note: "Full standard-code table as a downloadable file; no API key needed for the file itself.",
    },
    {
      name: "행정표준코드관리시스템 (code.go.kr)",
      url: "https://www.code.go.kr/",
      note: "The 행정안전부 system of record these datasets are mirrored from.",
    },
    {
      name: "국가법령정보센터 (law.go.kr)",
      url: "https://www.law.go.kr/",
      note: "Used to verify the 2026-07-01 전남광주통합특별시/인천 구제 개편 changes — see CURRENT_RESIDENCE_GAZETTEER_METADATA.verifiedLegalChanges for the specific laws.",
    },
  ],
} as const;

/** Lazily-built reverse index: city/county/district name -> every province it belongs to (job B / POLICY_REGION_GAZETTEER). */
let reverseIndex: Map<string, string[]> | undefined;

function getReverseIndex(): Map<string, string[]> {
  if (reverseIndex) return reverseIndex;
  const index = new Map<string, string[]>();
  for (const [province, cities] of Object.entries(POLICY_REGION_GAZETTEER)) {
    for (const city of cities) {
      const existing = index.get(city);
      if (existing) existing.push(province);
      else index.set(city, [province]);
    }
  }
  reverseIndex = index;
  return index;
}

/**
 * Resolves a city/county/district name to its parent province(s), for the
 * eligibility text parser (job B — historical names included).
 * - Unknown name -> `[]` (not in the gazetteer at all).
 * - Known, unambiguous name -> single-element array.
 * - Known but genuinely ambiguous (exists in 2+ provinces, e.g. 고성군,
 *   중구) -> multi-element array; callers must treat this as unresolved
 *   rather than guessing which province was meant.
 */
export function resolveCityProvinces(city: string): string[] {
  const trimmed = city.trim();
  if (!trimmed) return [];
  return getReverseIndex().get(trimmed) ?? [];
}

/** True when `city` is a real 시/군/구 name that belongs to exactly one province. */
export function isUnambiguousCity(city: string): boolean {
  return resolveCityProvinces(city).length === 1;
}

/** Every province's full list of cities/counties/districts recognized for POLICY TEXT parsing (job B — historical + current), for structural self-checks and other reuse. */
export function getGazetteer(): Readonly<Record<string, readonly string[]>> {
  return POLICY_REGION_GAZETTEER;
}

/** Every CURRENT province's full list of cities/counties/districts a new user may select from (job A), for structural self-checks and other reuse. */
export function getCurrentResidenceGazetteer(): Readonly<Record<string, readonly string[]>> {
  return CURRENT_RESIDENCE_GAZETTEER;
}

/**
 * Deterministic city/county/district options for a UI selector (onboarding,
 * profile page), given an exact canonical CURRENT province name (one of
 * `lib/constants/regions.ts`'s `PROVINCES` values, e.g. "경기도",
 * "전남광주통합특별시"). Reads `CURRENT_RESIDENCE_GAZETTEER` (job A) — never
 * returns an abolished/historical unit (e.g. 인천 중구, 광주광역시) even
 * though the parser-facing gazetteer still recognizes those in policy text.
 *
 * - Exact-match only: never resolves aliases ("경기" does NOT work here —
 *   pass the canonical string the province Select already produces) and
 *   never fuzzy-matches. An unrecognized/historical province returns `[]`.
 * - Always returns a fresh array copy so callers can never mutate the
 *   underlying gazetteer.
 * - This is the single shared source for both onboarding and the profile
 *   page's city selector — do not hand-copy per-province city lists into UI
 *   components.
 */
export function getCitiesForProvince(province: string): string[] {
  const cities = CURRENT_RESIDENCE_GAZETTEER[province];
  return cities ? [...cities] : [];
}

/** Lazily-built cache for `getShortDistrictNames`. */
let shortDistrictNames: string[] | undefined;

/**
 * Every POLICY_REGION_GAZETTEER (job B) city/county/district name that is
 * exactly 2 characters long (a 1-character stem + 시/군/구 suffix — e.g.
 * 중구, 동구, 서구, 남구, 북구). Derived from `POLICY_REGION_GAZETTEER` itself
 * rather than hardcoded, so it stays in sync if that gazetteer ever changes.
 *
 * This exists so the eligibility text parser can recognize these REAL short
 * district names (which a generic "2+ character stem" city-token regex
 * structurally cannot match) via an exact whitelist lookup, instead of
 * widening that regex to match any 1-character stem — which would also
 * match extremely common, non-geographic Korean 2-character words ending in
 * 시/군/구 (가구 "household", 인구 "population", 요구 "demand", 지구 "zone",
 * 축구/야구 "soccer/baseball") and create unwanted false-positive noise. An
 * exact match against this curated list carries none of that risk: every
 * name here is verified real geography, nothing else. (The 2026-07-01 new
 * Incheon names — 제물포구, 영종구, 검단구, 서해구 — are all 3-4 characters,
 * so none of them affect this whitelist.)
 */
export function getShortDistrictNames(): string[] {
  if (shortDistrictNames) return shortDistrictNames;
  const set = new Set<string>();
  for (const cities of Object.values(POLICY_REGION_GAZETTEER)) {
    for (const city of cities) {
      if (city.length === 2) set.add(city);
    }
  }
  shortDistrictNames = [...set];
  return shortDistrictNames;
}
