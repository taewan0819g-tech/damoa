/**
 * Ranking-only structured-region BREADTH classification.
 *
 * Checkpoint: Youth zipCd nationwide-personalization correction.
 *
 * `buildYouthRegionRule` (domain/youthCodebook/compatibility.ts) can now
 * build a `region_in` rule whose OR-list of `RegionSpec`s is drawn from a
 * Youth Center policy's raw `zipCd` roster. Some of those rosters name only
 * a handful of cities; others enumerate the ENTIRE current country (a
 * nationwide/unrestricted program that happens to be *expressed* as an
 * explicit OR-list rather than "no region rule at all"). `matchRegion`
 * (lib/eligibility/region.ts) correctly treats both shapes identically for
 * eligibility purposes — PASS is PASS, regardless of how broad the allowed
 * set is, and this module changes NONE of that.
 *
 * What `matchRegion` deliberately does NOT tell you is whether a spec that
 * happens to CONTAIN the user's city is meaningfully "about" that city, or
 * is just one of 200+ entries covering everywhere. That distinction matters
 * only for ranking-only personalization evidence (see
 * `domain/benefit/personalization.ts`'s `regionSpecificityForLeaf` /
 * `derivePersonalizationEvidence`): a nationwide OR-list must never be
 * treated as "exact-city" personalization evidence just because the user's
 * city happens to be one of the (every) cities it lists.
 *
 * This module answers that breadth question SEMANTICALLY, by comparing the
 * OR-list's union against the authoritative current gazetteers
 * (`lib/eligibility/regionGazetteer.ts`'s `CURRENT_RESIDENCE_GAZETTEER`,
 * `domain/region/subdivisionPartition.ts`'s `PARENT_CITY_SUBDIVISIONS`) —
 * never by a token-count threshold or a title/provider heuristic. A
 * province/city is "fully covered" only when the specs provably leave no
 * current resident of it outside the union; a benefit that merely lists
 * *most* cities of a province is correctly NOT classified as covering that
 * province.
 *
 * Deliberately NEVER imported by `lib/eligibility/region.ts`/`ruleEngine.ts`
 * — eligibility (`matchRegion` PASS/FAIL/UNKNOWN) is completely unaffected
 * by this module; it exists purely to feed ranking-only evidence.
 *
 * Performance: classification of a given `RegionSpec[]` array is cached by
 * ARRAY REFERENCE (`WeakMap`), process-local and deterministic. Every
 * `region_in` rule's `value` is built once (at adapter-normalize time) and
 * reused, by reference, across every profile evaluation of that benefit
 * (see `evaluateGroup`'s `evidenceLeaves` in lib/eligibility/ruleEngine.ts,
 * which forwards the original rule object, not a copy) — so this cache
 * amortizes the one-time O(current provinces x cities) coverage computation
 * across every user who is ever matched against that benefit, instead of
 * recomputing it per request.
 */

import { normalizeProvince, type RegionSpec } from "@/lib/eligibility/region";
import { getCurrentResidenceGazetteer } from "@/lib/eligibility/regionGazetteer";
import {
  isSubdividedParentCity,
  subdivisionUnionCoversUser,
  type SubdivisionRegion,
} from "./subdivisionPartition";

interface SpecCoverage {
  /**
   * Every CURRENT province (canonical name) that `specs`, as an OR-union,
   * provably cover in full -- every current city/gu of that province is
   * inside the union, not merely "some entry happens to name it".
   */
  fullyCoveredProvinces: ReadonlySet<string>;
  /** True iff `fullyCoveredProvinces` is every currently-selectable province. */
  isNationwide: boolean;
}

/**
 * Keyed by the `RegionSpec[]` array's OWN IDENTITY (not a content hash) --
 * safe because every `region_in` rule's `value` is a single array built once
 * at normalize time and never mutated or recreated per request.
 */
const coverageCache = new WeakMap<RegionSpec[], SpecCoverage>();

function isCityFullyCovered(
  province: string,
  city: string,
  directCities: ReadonlySet<string>,
  subdivisionsByCity: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  if (directCities.has(city)) return true;
  if (!isSubdividedParentCity(province, city)) return false;
  const have = subdivisionsByCity.get(city);
  if (!have || have.size === 0) return false;
  const specs: SubdivisionRegion[] = [...have].map((subdivision) => ({ province, city, subdivision }));
  return subdivisionUnionCoversUser({ province, city }, specs);
}

function isProvinceFullyCovered(
  province: string,
  specsForProvince: readonly RegionSpec[],
  citiesInProvince: readonly string[]
): boolean {
  // An explicit whole-province spec (no `city`) trivially covers everything
  // in it, regardless of what else is in the list.
  if (specsForProvince.some((s) => !s.city)) return true;
  // Cityless provinces (세종특별자치시) have no sub-roster to enumerate -- any
  // spec that names the province at all already covers its one unit.
  if (citiesInProvince.length === 0) return specsForProvince.length > 0;

  const directCities = new Set<string>();
  const subdivisionsByCity = new Map<string, Set<string>>();
  for (const spec of specsForProvince) {
    if (!spec.city) continue;
    if (spec.subdivision) {
      const set = subdivisionsByCity.get(spec.city) ?? new Set<string>();
      set.add(spec.subdivision);
      subdivisionsByCity.set(spec.city, set);
    } else {
      directCities.add(spec.city);
    }
  }

  return citiesInProvince.every((city) => isCityFullyCovered(province, city, directCities, subdivisionsByCity));
}

function computeCoverage(specs: RegionSpec[]): SpecCoverage {
  const gazetteer = getCurrentResidenceGazetteer();
  const allProvinces = Object.keys(gazetteer);

  const byProvince = new Map<string, RegionSpec[]>();
  for (const spec of specs) {
    const province = normalizeProvince(spec.province);
    if (!province) continue;
    const list = byProvince.get(province);
    if (list) list.push(spec);
    else byProvince.set(province, [spec]);
  }

  const fullyCoveredProvinces = new Set<string>();
  for (const province of allProvinces) {
    const specsForProvince = byProvince.get(province);
    if (!specsForProvince || specsForProvince.length === 0) continue;
    if (isProvinceFullyCovered(province, specsForProvince, gazetteer[province])) {
      fullyCoveredProvinces.add(province);
    }
  }

  return {
    fullyCoveredProvinces,
    isNationwide: allProvinces.length > 0 && fullyCoveredProvinces.size === allProvinces.length,
  };
}

function getCoverage(specs: RegionSpec[]): SpecCoverage {
  const cached = coverageCache.get(specs);
  if (cached) return cached;
  const computed = computeCoverage(specs);
  coverageCache.set(specs, computed);
  return computed;
}

/**
 * True when `specs` (a `region_in` rule's allowed OR-list), taken together,
 * provably cover EVERY current Damoa-selectable province and city -- i.e.
 * the condition is nationwide/unrestricted in effect, even though it's
 * structurally an explicit OR-list rather than "no region rule at all".
 *
 * Ranking-only: `matchRegion` (eligibility) is untouched by this function
 * and still evaluates the very same `specs` exactly as before.
 */
export function isNationwideRegionSpec(specs: readonly RegionSpec[]): boolean {
  if (specs.length === 0) return false;
  return getCoverage(specs as RegionSpec[]).isNationwide;
}

/**
 * True when `specs`, as an OR-union, provably cover `province` IN FULL --
 * every current city/gu of that province is inside the union -- as opposed
 * to a proper local subset that merely happens to include one of its
 * cities. Ranking-only; distinguishes genuinely province-wide personalization
 * evidence from a narrower local match.
 */
export function isProvinceWideRegionSpec(specs: readonly RegionSpec[], province: string): boolean {
  const normalized = normalizeProvince(province);
  if (!normalized || specs.length === 0) return false;
  return getCoverage(specs as RegionSpec[]).fullyCoveredProvinces.has(normalized);
}
