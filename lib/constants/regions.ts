/**
 * Provinces a NEW user may currently select in onboarding/profile (job A —
 * see regionGazetteer.ts's file header). Must stay in sync with
 * `CURRENT_RESIDENCE_GAZETTEER`'s key set in regionGazetteer.ts: every
 * province listed here must have a (possibly empty) city roster there, and
 * vice versa — `getCitiesForProvince` silently returns `[]` for any mismatch,
 * so a drift here would look like a province with zero selectable cities
 * instead of a loud error.
 *
 * 2026-07-01: 광주광역시 + 전라남도 merged into 전남광주통합특별시 (see
 * regionGazetteer.ts file header for full sourcing) — listed here in place of
 * both predecessor names, never alongside them, since a new user can only
 * ever pick the current legal roster.
 */
export const PROVINCES = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "전남광주통합특별시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;
