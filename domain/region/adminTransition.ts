/**
 * Explicit, deterministic administrative-transition compatibility layer.
 *
 * Checkpoint: Final Region Transition Compatibility.
 *
 * `lib/eligibility/region.ts`'s `matchRegion()` used to require exact
 * province/city string equality. That's correct for two residences that are
 * genuinely the same place expressed the same way, but it is WRONG for the
 * 2026-07-01 administrative transitions (see `lib/eligibility/regionGazetteer.ts`'s
 * file header): a user residing under a CURRENT name and a policy expressed
 * in the OLD name (or vice versa) may still refer to overlapping or even
 * identical real-world territory. Hard-failing those pairs is a false
 * negative; silently aliasing old<->new names (as `PROVINCE_ALIASES` already
 * explains it deliberately does NOT do) would be a false positive, because
 * this codebase cannot determine from geography alone whether an old
 * province-specific program's eligibility legally extends to the new entity.
 *
 * The correct model is neither equality nor alias: it's set containment.
 * Damoa's constraint-compatibility principle: treat a user's residence as a
 * SET of real-world territory U, and a policy's region requirement as a set
 * P. Then:
 *
 *   - U ∩ P = ∅            => FAIL     (provably unrelated places)
 *   - U ∩ P != ∅ and U ⊄ P  => UNKNOWN  (overlap, but not fully covered —
 *                                        cannot prove the user qualifies)
 *   - U ⊆ P                 => PASS     (user's territory is fully inside
 *                                        the policy's territory)
 *
 * This module contains ONLY the two verified 2026-07-01 transitions (the
 * 전남광주통합특별시 merger and the 인천 구제 개편). It is intentionally NOT a
 * generic fuzzy-matching or geocoding layer — every relation here is a
 * hand-verified fact about a specific, named administrative change, and an
 * unmodeled pair always falls back to "disjoint" (i.e. ordinary exact-match
 * behavior, unchanged from before this checkpoint).
 */

import {
  GWANGJU_DISTRICTS,
  INCHEON_CURRENT_DISTRICTS,
  INCHEON_HISTORICAL_DISTRICTS,
  JEONNAM_CITIES,
} from "@/lib/eligibility/regionGazetteer";

/** Set-containment relation between a user's residence-territory U and a policy's required territory P. */
export type TerritoryRelation = "contained" | "overlap" | "disjoint";

const GWANGJU_SET = new Set<string>(GWANGJU_DISTRICTS);
const JEONNAM_SET = new Set<string>(JEONNAM_CITIES);
const INCHEON_HISTORICAL_SET = new Set<string>(INCHEON_HISTORICAL_DISTRICTS);
const INCHEON_CURRENT_SET = new Set<string>(INCHEON_CURRENT_DISTRICTS);

const JEONNAM_GWANGJU_NEW_PROVINCE = "전남광주통합특별시";

// ---------------------------------------------------------------------------
// Incheon district split/merge (intra-province, city-level transition).
// ---------------------------------------------------------------------------

/**
 * Hand-verified fact table for each OLD Incheon district's relationship to
 * each NEW Incheon district it overlaps with real-world territory:
 *
 *  - "oldSubset": the OLD district's entire territory is inside the NEW one
 *    (old ⊆ new for this pair) — e.g. all of former 동구 became 제물포구.
 *  - "newSubset": the NEW district's entire territory is inside the OLD one
 *    (new ⊆ old for this pair) — e.g. 영종구 is exactly former 중구's island
 *    portion, wholly within old 중구.
 *  - "overlap": neither fully contains the other — e.g. 제물포구 is made of
 *    parts of BOTH old 중구 and old 동구, so old 중구 alone doesn't cover all
 *    of 제물포구, and 제물포구 alone doesn't cover all of old 중구 either.
 *
 * Any old/new pair NOT listed here has zero real-world territorial overlap
 * (fully disjoint) — e.g. old 서구 and new 영종구 never touched each other.
 */
const INCHEON_OLD_TO_NEW_FACTS: Record<string, Record<string, "oldSubset" | "newSubset" | "overlap">> = {
  "중구": { "영종구": "newSubset", "제물포구": "overlap" },
  "동구": { "제물포구": "oldSubset" },
  "서구": { "서해구": "newSubset", "검단구": "newSubset" },
};

type IncheonEra = "historical" | "current" | "other";

function incheonEraOf(city: string): IncheonEra {
  if (INCHEON_HISTORICAL_SET.has(city)) return "historical";
  if (INCHEON_CURRENT_SET.has(city)) return "current";
  return "other";
}

/**
 * Territory relation between a user's Incheon district `userCity` (U) and a
 * policy's required Incheon district `specCity` (P), both already confirmed
 * to be under the (unchanged) 인천광역시 province on both sides.
 *
 * Returns `undefined` when neither city is a transitioned district (either
 * both are unaffected/unknown districts, or both are from the same era) —
 * callers should treat `undefined` as "not a modeled transition pair",
 * falling back to ordinary exact-match ("disjoint" unless equal, which the
 * caller already checks before calling this).
 */
export function incheonCityRelation(userCity: string, specCity: string): TerritoryRelation | undefined {
  const userEra = incheonEraOf(userCity);
  const specEra = incheonEraOf(specCity);

  if (userEra === "other" || specEra === "other") return undefined;
  if (userEra === specEra) return undefined; // same era, different district name -> genuinely different place

  if (userEra === "historical" && specEra === "current") {
    // User resides under an OLD name, policy is expressed with a NEW name.
    const fact = INCHEON_OLD_TO_NEW_FACTS[userCity]?.[specCity];
    if (fact === "oldSubset") return "contained"; // U(old) ⊆ P(new)
    if (fact === "newSubset") return "overlap"; // P(new) ⊆ U(old) => U ⊇ P, not U ⊆ P, but they do overlap
    if (fact === "overlap") return "overlap";
    return undefined; // not a related pair -> disjoint
  }

  // userEra === "current" && specEra === "historical": user resides under a
  // NEW name, policy is expressed with an OLD name.
  const fact = INCHEON_OLD_TO_NEW_FACTS[specCity]?.[userCity];
  if (fact === "newSubset") return "contained"; // U(new) ⊆ P(old)
  if (fact === "oldSubset") return "overlap"; // P(old) ⊆ U(new) => overlap, not full containment
  if (fact === "overlap") return "overlap";
  return undefined;
}

// ---------------------------------------------------------------------------
// 전남광주통합특별시 merger (cross-province, lossless province-level merge).
// ---------------------------------------------------------------------------

type GwangjuJeonnamHeritage = "gwangju" | "jeonnam" | undefined;

function classifyGwangjuJeonnamCity(city: string | undefined): GwangjuJeonnamHeritage {
  if (!city) return undefined;
  if (GWANGJU_SET.has(city)) return "gwangju";
  if (JEONNAM_SET.has(city)) return "jeonnam";
  return undefined;
}

/**
 * Territory relation between a user's residence (userProvince/userCity) and
 * a policy's required region (specProvince/specCity), for the ONE modeled
 * cross-province transition: 광주광역시 + 전라남도 -> 전남광주통합특별시. Both
 * provinces are assumed already normalized and already confirmed different
 * (the caller only reaches here after an exact-province-match check fails).
 *
 * Returns `undefined` when the pair isn't part of this transition at all
 * (neither side is 전남광주통합특별시 paired with 광주광역시/전라남도) — caller
 * falls back to "disjoint".
 */
export function gwangjuJeonnamRelation(
  userProvince: string,
  userCity: string | undefined,
  specProvince: string,
  specCity: string | undefined
): TerritoryRelation | undefined {
  const isOldProvince = (p: string) => p === "광주광역시" || p === "전라남도";

  if (userProvince === JEONNAM_GWANGJU_NEW_PROVINCE && isOldProvince(specProvince)) {
    // User resides under the NEW merged province; policy is expressed with
    // an OLD (pre-merger) province name. The merge is lossless (every inch
    // of both old provinces is inside the new one), so:
    if (!userCity) {
      // User's city within the new province is unspecified -> we can't tell
      // which old-province heritage they belong to -> overlap, not proven.
      return "overlap";
    }
    const heritage = classifyGwangjuJeonnamCity(userCity);
    const specHeritage = specProvince === "광주광역시" ? "gwangju" : "jeonnam";
    if (heritage !== specHeritage) return "disjoint"; // user's city belongs to the OTHER old province
    if (!specCity) return "contained"; // policy allows the whole old province, user's city is provably inside it
    return userCity === specCity ? "contained" : "disjoint";
  }

  if (specProvince === JEONNAM_GWANGJU_NEW_PROVINCE && isOldProvince(userProvince)) {
    // User resides under an OLD (pre-merger) province name; policy is
    // expressed with the NEW merged province name. Since the merge is
    // lossless, the user's entire old-province territory is provably inside
    // the new province.
    if (!specCity) return "contained"; // policy allows the whole new province -> old province is fully inside it
    if (!userCity) return "overlap"; // policy wants a specific new-province city, user's city is unspecified
    return userCity === specCity ? "contained" : "disjoint";
  }

  return undefined;
}
