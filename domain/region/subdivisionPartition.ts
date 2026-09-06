/**
 * Explicit, deterministic parent-city / subordinate-district partition
 * table.
 *
 * Checkpoint: Youth zipCd structured region eligibility (subdivision
 * constraint-compatibility correction).
 *
 * Thirteen Korean 일반시 (수원시, 성남시, 안양시, 부천시, 안산시, 고양시, 용인시,
 * 화성시, 청주시, 천안시, 포항시, 창원시, 전주시) are internally divided into
 * legally real 구 (e.g. 수원시 장안구/권선구/팔달구/영통구), each with its OWN
 * 법정동코드. `CURRENT_RESIDENCE_GAZETTEER` (lib/eligibility/regionGazetteer.ts)
 * deliberately stores these 13 cities as flat, gu-less residence units — a
 * Damoa profile can say `{ province: "경기도", city: "수원시" }` but NEVER
 * `{ ..., city: "수원시 장안구" }`, because the onboarding/profile UI never
 * asks a user which gu of these 13 cities they live in.
 *
 * That granularity mismatch means a policy region rule expressed at the
 * SUBORDINATE-GU level (e.g. a Youth Center benefit whose zipCd resolves to
 * "수원시 장안구" specifically) can NEVER be safely collapsed to an ordinary
 * `{ province, city: "수원시" }` RegionSpec — doing so would silently promote
 * every 수원시 resident (regardless of which of the 4 gu they actually live
 * in) to a PASS, when in truth we only know they live SOMEWHERE inside
 * 수원시, not specifically inside 장안구. Per Damoa's constraint-compatibility
 * principle (see domain/region/adminTransition.ts's file header): with
 * U = "somewhere in 수원시" and P = "장안구", U ∩ P != ∅ but U ⊄ P, so the
 * correct verdict is UNKNOWN, never PASS.
 *
 * `RegionSpec.subdivision` (lib/eligibility/region.ts) carries this
 * distinction. This module supplies the one piece of authoritative data
 * needed to resolve an OR-list of subdivision specs against a user who is
 * only known down to the parent-city level: the exhaustive, versioned list
 * of every CURRENT subordinate gu for each of the 13 cities. If an allowed
 * OR-list's subdivision specs for a given parent city, unioned together,
 * exactly cover every gu in that list, the user's entire (unknown-gu)
 * territory is provably inside the union, and the verdict becomes PASS —
 * exactly mirroring `transitionUnionCoversUser`'s OR-union-completion
 * principle for the 2026-07-01 administrative transitions, but for ordinary
 * intra-city granularity instead of a historical boundary change.
 *
 * Source: same official 법정동코드 dataset as
 * `lib/eligibility/regionGazetteer.ts`'s `CURRENT_RESIDENCE_GAZETTEER` (see
 * `PARENT_CITY_SUBDIVISION_PROVENANCE` below for the specific file/hash) —
 * NOT re-derived from Youth Center data, titles, or provider names. Every
 * one of these 39 gu is independently a "존재" (current, not 폐지) row in
 * that dataset.
 */

/** A normalized (post `normalizeProvince`/trim) province+city+subdivision territory. */
export interface SubdivisionRegion {
  province: string;
  city: string;
  subdivision: string;
}

/**
 * province -> parent city -> exhaustive list of that city's CURRENT
 * subordinate 구. Every city key here is one of the 13 gu-bearing cities;
 * every other Korean city/county is intentionally absent (it has no
 * subordinate-gu structure at all, so `RegionSpec.subdivision` never applies
 * to it).
 */
export const PARENT_CITY_SUBDIVISIONS: Record<string, Record<string, string[]>> = {
  "경기도": {
    "수원시": ["장안구", "권선구", "팔달구", "영통구"],
    "성남시": ["수정구", "중원구", "분당구"],
    "안양시": ["만안구", "동안구"],
    "부천시": ["원미구", "소사구", "오정구"],
    "안산시": ["상록구", "단원구"],
    "고양시": ["덕양구", "일산동구", "일산서구"],
    "용인시": ["처인구", "기흥구", "수지구"],
    "화성시": ["만세구", "효행구", "병점구", "동탄구"],
  },
  "충청북도": {
    "청주시": ["상당구", "서원구", "흥덕구", "청원구"],
  },
  "충청남도": {
    "천안시": ["동남구", "서북구"],
  },
  "경상북도": {
    "포항시": ["남구", "북구"],
  },
  "경상남도": {
    "창원시": ["의창구", "성산구", "마산합포구", "마산회원구", "진해구"],
  },
  "전북특별자치도": {
    "전주시": ["완산구", "덕진구"],
  },
};

/** Machine-readable provenance for `PARENT_CITY_SUBDIVISIONS` (and, transitively, `domain/youthCodebook/zipCdCrosswalk.ts`'s subdivision-typed entries). */
export const PARENT_CITY_SUBDIVISION_PROVENANCE = {
  version: "2026-07-bjdong-full.1",
  effectiveAsOf: "2026-07-01",
  sourceType: "official_government_dataset" as const,
  sourceFilename: "법정동코드 전체자료.zip",
  sourceInnerFilename: "법정동코드 전체자료.txt",
  sourceEncoding: "cp949",
  sourceSha256: "7b4b544a6302d26c4f4c89d2c1355beae82e958c786bad8cc8572db0d2e2eb33",
  sourceInnerSha256: "8cfd829c797270b56243a46e9f1e4e95377c2135153c36909021a35a1e32966a",
  totalDataRows: 53387,
  parentCityCount: 13,
  subordinateGuCount: 39,
  authoritative: true,
  note:
    "Every subordinate-gu name/count above was extracted by parsing every " +
    "현재(존재) row of the official 법정동코드 전체자료 dataset whose 법정동명 " +
    "has the form '<province> <one of the 13 parent cities> <구>', grouped " +
    "by parent city. Cross-checked: the 13 parent-city names exactly match " +
    "CURRENT_RESIDENCE_GAZETTEER's flat (gu-less) entries for 수원시/성남시/" +
    "안양시/부천시/안산시/고양시/용인시/화성시/청주시/천안시/포항시/창원시/전주시.",
} as const;

function normalize(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Whether `province`/`city` is one of the 13 gu-bearing parent cities this
 * module knows about (i.e. `RegionSpec.subdivision` can legitimately apply).
 */
export function isSubdividedParentCity(province: string, city: string): boolean {
  return Boolean(PARENT_CITY_SUBDIVISIONS[province]?.[city]);
}

/**
 * Given a user's parent-city-level residence and the set of subdivision
 * specs (all already confirmed to share that same province/city) that were
 * individually "overlap" against the user, determines whether their union
 * exhaustively covers every current subordinate gu of that city — i.e.
 * whether U (somewhere in the parent city) ⊆ P1 ∪ P2 ∪ ... (the allowed
 * gu set). Returns false (never PASS) for any city not in
 * `PARENT_CITY_SUBDIVISIONS` — this never invents coverage facts beyond the
 * authoritative partition table above.
 */
export function subdivisionUnionCoversUser(
  user: { province: string; city: string },
  overlappingSpecs: SubdivisionRegion[]
): boolean {
  const allGu = PARENT_CITY_SUBDIVISIONS[user.province]?.[user.city];
  if (!allGu || allGu.length === 0) return false;

  const allowedGu = new Set(
    overlappingSpecs
      .filter((spec) => spec.province === user.province && spec.city === user.city)
      .map((spec) => normalize(spec.subdivision))
      .filter((v): v is string => Boolean(v))
  );

  return allGu.every((gu) => allowedGu.has(gu));
}
