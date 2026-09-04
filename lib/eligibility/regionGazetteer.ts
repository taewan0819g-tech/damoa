/**
 * Canonical, deterministic Korean administrative-region gazetteer: every
 * 기초자치단체 (시/군/구) mapped to its parent province/metropolitan-city
 * (광역자치단체), built from curated data (not fuzzy/ML matching).
 *
 * This is the reusable domain module that lets the eligibility text parser
 * resolve a LONE city/county/district mention (no explicit province in the
 * same clause, e.g. "이천시 거주자") to its province, the same way a human
 * reader would — without ever guessing when a name is genuinely ambiguous.
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
 * PROVENANCE — this is HAND-CURATED reference data, not the long-term source
 * of truth. See `GAZETTEER_METADATA` below for machine-readable version
 * info. Do not assume this file is complete or auto-refreshed.
 *
 * Source: standard 시/군/구 (기초자치단체) rosters as of the 2023 군위군
 * (경상북도 -> 대구광역시) transfer, transcribed by hand and checked against
 * the 17 provinces' publicly known city/county/district counts. Not sourced
 * from any live API or scrape — this is static reference geography, not
 * eligibility content, and it intentionally contains ONLY real, verifiable
 * administrative names (no fuzzy/ML-derived entries).
 *
 * AUTHORITATIVE SOURCE FOR A FUTURE DETERMINISTIC REGENERATION (investigated,
 * not yet integrated — see GAZETTEER_METADATA.candidateAuthoritativeSources):
 * the Korean Ministry of the Interior and Safety (행정안전부) publishes the
 * 법정동코드 (legal-dong code) standard table via 행정표준코드관리시스템
 * (code.go.kr), which is mirrored on the public open-data portal
 * (data.go.kr) both as a downloadable file and an OpenAPI endpoint —
 * e.g. dataset "행정안전부_행정표준코드_법정동코드"
 * (https://www.data.go.kr/data/15077871/openapi.do) and the full-code
 * download "행정안전부_행정표준코드_전체코드_다운로드"
 * (https://www.data.go.kr/data/15092039/fileData.do). Each row carries
 * 시도명/시군구명 (and finer 읍면동/리 levels we don't need), which is exactly
 * the province->city mapping this file hand-encodes. A follow-up script
 * could fetch that table, collapse it to the unique 시도/시군구 pairs, and
 * regenerate `CITY_GAZETTEER` deterministically — but that requires a
 * data.go.kr API key/registration and a verification pass (matching every
 * row against `PROVINCE_ALIAS_KEYS` in region.ts, confirming no accidental
 * drops of valid 시/군/구), which is out of scope for this change. This file
 * is NOT scraped or auto-generated; it stays hand-curated until that
 * follow-up is done and reviewed.
 *
 * 2026-09-04 FRESHNESS RE-AUDIT (see docs/audits/region-gazetteer-freshness.json
 * for full sourcing): verified via multiple independent news sources that
 * two real administrative changes took effect 2026-07-01 — (1) 광주광역시 and
 * 전라남도 merged into "전남광주통합특별시" (「전남광주통합특별시 설치 및 지원에
 * 관한 특별법」), and (2) 인천광역시 abolished 중구/동구, created
 * 제물포구/영종구/검단구, and renamed 서구 -> 서해구 (「인천광역시 제물포구,
 * 영종구 및 검단구 설치 등에 관한 법률」, enacted 2023, effective 2026-07-01).
 * These are NOT applied to `CITY_GAZETTEER` below: this table is also the
 * data eligibility-rule extraction (`koreanEligibilityParser.ts`) reads to
 * resolve region mentions in raw MOIS/Youth benefit text, and empirically
 * swapping in the post-2026-07-01 roster changes candidate-matching results
 * against the frozen benefit catalog (confirmed: 21 candidate-membership
 * diffs across 5 test profiles, including real records like
 * mois-349000000105 "사회복지 증진 지원" and mois-350000000101
 * "지역화폐(제물포구사랑상품권)", both already tagged 인천광역시 영종구/제물포구
 * in their agency metadata even though the gazetteer doesn't yet recognize
 * those district names). Applying this update is out of scope for a
 * UI/input-quality checkpoint that must hold eligibility/candidate output
 * frozen — see the audit artifact for the full blocker writeup and the
 * recommended follow-up (a dedicated eligibility-rule-extraction checkpoint
 * that re-derives region rules from re-ingested catalog text together with
 * this roster update, verifying old-name/new-name bridging deliberately
 * rather than incidentally).
 * ---------------------------------------------------------------------------
 */

/**
 * Machine-readable provenance for this static dataset. Bump `version` any
 * time `CITY_GAZETTEER` changes (an added/removed/renamed 시/군/구, a
 * province transfer like the 2023 군위군 move). `authoritative: false` is
 * load-bearing documentation: this table is a hand-curated approximation of
 * the real administrative roster, good enough for the parser's safety-net
 * use case (never assert a wrong region, fall back to unresolved when
 * unsure) but NOT a substitute for the government's own code table if this
 * data is ever needed for a purpose that requires legal precision.
 */
export const GAZETTEER_METADATA = {
  version: "2023-07-gunwi-transfer.1",
  effectiveAsOf: "2023-07-01", // 군위군 경상북도 -> 대구광역시 transfer date
  sourceType: "manual" as const,
  source:
    "Hand-transcribed from standard 시/군/구 (기초자치단체) rosters; cross-checked against known per-province city/county/district counts. Not fetched from a live API.",
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
  ],
} as const;

const CITY_GAZETTEER: Record<string, string[]> = {
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
  "인천광역시": [
    "중구", "동구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "서구",
    "강화군", "옹진군",
  ],
  "광주광역시": ["동구", "서구", "남구", "북구", "광산구"],
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
  "전라남도": [
    "목포시", "여수시", "순천시", "나주시", "광양시",
    "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군",
    "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군",
    "신안군",
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

/** Lazily-built reverse index: city/county/district name -> every province it belongs to. */
let reverseIndex: Map<string, string[]> | undefined;

function getReverseIndex(): Map<string, string[]> {
  if (reverseIndex) return reverseIndex;
  const index = new Map<string, string[]>();
  for (const [province, cities] of Object.entries(CITY_GAZETTEER)) {
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
 * Resolves a city/county/district name to its parent province(s).
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

/** Every province's full list of cities/counties/districts, for structural self-checks and other reuse. */
export function getGazetteer(): Readonly<Record<string, readonly string[]>> {
  return CITY_GAZETTEER;
}

/**
 * Deterministic city/county/district options for a UI selector (onboarding,
 * profile page), given an exact canonical province name (one of
 * `lib/constants/regions.ts`'s `PROVINCES` values, e.g. "경기도").
 *
 * - Exact-match only: never resolves aliases ("경기" does NOT work here —
 *   pass the canonical string the province Select already produces) and
 *   never fuzzy-matches. An unrecognized province returns `[]`.
 * - Always returns a fresh array copy so callers can never mutate the
 *   underlying gazetteer.
 * - This is the single shared source for both onboarding and the profile
 *   page's city selector — do not hand-copy per-province city lists into UI
 *   components.
 */
export function getCitiesForProvince(province: string): string[] {
  const cities = CITY_GAZETTEER[province];
  return cities ? [...cities] : [];
}

/** Lazily-built cache for `getShortDistrictNames`. */
let shortDistrictNames: string[] | undefined;

/**
 * Every gazetteer city/county/district name that is exactly 2 characters
 * long (a 1-character stem + 시/군/구 suffix — e.g. 중구, 동구, 서구, 남구,
 * 북구). Derived from `CITY_GAZETTEER` itself rather than hardcoded, so it
 * stays in sync if the gazetteer ever changes.
 *
 * This exists so the eligibility text parser can recognize these REAL short
 * district names (which a generic "2+ character stem" city-token regex
 * structurally cannot match) via an exact whitelist lookup, instead of
 * widening that regex to match any 1-character stem — which would also
 * match extremely common, non-geographic Korean 2-character words ending in
 * 시/군/구 (가구 "household", 인구 "population", 요구 "demand", 지구 "zone",
 * 축구/야구 "soccer/baseball") and create unwanted false-positive noise. An
 * exact match against this curated list carries none of that risk: every
 * name here is verified real geography, nothing else.
 */
export function getShortDistrictNames(): string[] {
  if (shortDistrictNames) return shortDistrictNames;
  const set = new Set<string>();
  for (const cities of Object.values(CITY_GAZETTEER)) {
    for (const city of cities) {
      if (city.length === 2) set.add(city);
    }
  }
  shortDistrictNames = [...set];
  return shortDistrictNames;
}
