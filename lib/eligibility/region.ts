/**
 * Hierarchical Korean administrative-region matching used by the
 * `region_in` rule operator. Deliberately NOT fuzzy: only the explicit
 * alias table below normalizes province names (e.g. "경기" / "경기도" both
 * mean the same province). Cities/districts are compared by exact string
 * equality after trimming — no substring or edit-distance matching — so a
 * benefit can never silently match the wrong city.
 *
 * Checkpoint: Final Region Transition Compatibility. Exact string equality
 * alone is too strict for the two verified 2026-07-01 administrative
 * transitions (전남광주통합특별시 merger, 인천 구제 개편): a user residing under
 * a CURRENT name and a policy expressed in an OLD name (or vice versa) may
 * still refer to overlapping or identical real-world territory, and
 * hard-failing that pair is a false negative. `matchRegion` therefore treats
 * a residence/spec pair as sets of real-world territory and applies
 * Damoa's constraint-compatibility principle (U = user's territory, P =
 * policy's required territory): U ∩ P = ∅ => fail; U ∩ P != ∅ and U ⊄ P =>
 * unknown; U ⊆ P => pass. The specific old<->new containment/overlap facts
 * live in `domain/region/adminTransition.ts` — deliberately NOT simple
 * string aliases (see that module's header for why). Every pair not
 * involved in one of those two named transitions falls back to ordinary
 * exact-match behavior, unchanged from before this checkpoint.
 */

import {
  gwangjuJeonnamRelation,
  incheonCityRelation,
  transitionUnionCoversUser,
  type NormalizedRegion,
  type TerritoryRelation,
} from "@/domain/region/adminTransition";

export interface RegionSpec {
  /** Province/metropolitan-city name, e.g. "경기도", "서울특별시". */
  province: string;
  /** City/county/district name. Omit to allow the whole province. */
  city?: string;
}

export const PROVINCE_ALIASES: Record<string, string> = {
  "서울": "서울특별시",
  "서울시": "서울특별시",
  "서울특별시": "서울특별시",
  "부산": "부산광역시",
  "부산시": "부산광역시",
  "부산광역시": "부산광역시",
  "대구": "대구광역시",
  "대구시": "대구광역시",
  "대구광역시": "대구광역시",
  "인천": "인천광역시",
  "인천시": "인천광역시",
  "인천광역시": "인천광역시",
  "광주": "광주광역시",
  "광주시": "광주광역시",
  "광주광역시": "광주광역시",
  "대전": "대전광역시",
  "대전시": "대전광역시",
  "대전광역시": "대전광역시",
  "울산": "울산광역시",
  "울산시": "울산광역시",
  "울산광역시": "울산광역시",
  "세종": "세종특별자치시",
  "세종시": "세종특별자치시",
  "세종특별자치시": "세종특별자치시",
  "경기": "경기도",
  "경기도": "경기도",
  "강원": "강원특별자치도",
  "강원도": "강원특별자치도",
  "강원특별자치도": "강원특별자치도",
  "충북": "충청북도",
  "충청북도": "충청북도",
  "충남": "충청남도",
  "충청남도": "충청남도",
  "전북": "전북특별자치도",
  "전라북도": "전북특별자치도",
  "전북특별자치도": "전북특별자치도",
  "전남": "전라남도",
  "전라남도": "전라남도",
  "경북": "경상북도",
  "경상북도": "경상북도",
  "경남": "경상남도",
  "경상남도": "경상남도",
  "제주": "제주특별자치도",
  "제주도": "제주특별자치도",
  "제주특별자치도": "제주특별자치도",
  // 광주광역시 + 전라남도 merged into a single 광역자치단체 effective 2026-07-01
  // (「전남광주통합특별시 설치를 위한 특별법」, 법률 제21446호). Deliberately NOT
  // aliased to/from "광주"/"광주광역시"/"전남"/"전라남도" above — this is a new,
  // separate canonical province name, not a surface-form alias of either
  // predecessor. See regionGazetteer.ts's file header and
  // docs/audits/region-gazetteer-freshness.json for why old<->new province
  // identity is deliberately never asserted as equivalent for matching
  // purposes (a lossless geographic merger doesn't guarantee an old
  // province-specific program's eligibility legally extends to the whole new
  // entity, or vice versa).
  "전남광주통합특별시": "전남광주통합특별시",
};

/**
 * All recognized province alias surface forms (e.g. "서울", "서울시",
 * "서울특별시"), for callers that need to scan free text for a province
 * mention (see `koreanEligibilityParser.ts`'s `findProvinceMention`).
 */
export const PROVINCE_ALIAS_KEYS: string[] = Object.keys(PROVINCE_ALIASES);

/** Normalizes a province name via the explicit alias table. Falls back to a trimmed copy of the input for unrecognized-but-consistent names. */
export function normalizeProvince(input?: string | null): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  return PROVINCE_ALIASES[trimmed] ?? trimmed;
}

function normalizeCity(input?: string | null): string | undefined {
  const trimmed = input?.trim();
  return trimmed || undefined;
}

/**
 * Territory relation (see file header) between a user's normalized residence
 * and a single allowed `spec`. Reduces to plain exact-match semantics for
 * every pair not covered by a modeled administrative transition:
 *
 * - Same province, spec allows whole province -> "contained".
 * - Same province, spec city unknown to us -> "overlap" (could be right).
 * - Same province, spec city equal to user city -> "contained".
 * - Same province (must be 인천광역시), spec city different -> consult the
 *   Incheon split/merge facts; unmodeled pairs fall back to "disjoint".
 * - Different province -> consult the 전남광주통합특별시 merger facts;
 *   unmodeled pairs fall back to "disjoint".
 */
function regionRelation(
  user: { province: string; city?: string },
  spec: RegionSpec
): TerritoryRelation {
  const specProvince = normalizeProvince(spec.province);
  if (!specProvince) return "disjoint";
  const specCity = normalizeCity(spec.city);

  if (user.province === specProvince) {
    if (!specCity) return "contained";
    if (!user.city) return "overlap";
    if (user.city === specCity) return "contained";
    if (user.province === "인천광역시") {
      const relation = incheonCityRelation(user.city, specCity);
      if (relation) return relation;
    }
    return "disjoint";
  }

  return gwangjuJeonnamRelation(user.province, user.city, specProvince, specCity) ?? "disjoint";
}

/**
 * Matches a user's residence against an OR'd list of allowed regions.
 *
 * - No residence info at all -> "unknown" (can't rule it in or out).
 * - Every allowed spec provably excludes the user's territory -> "fail".
 * - Some allowed spec's territory fully contains the user's territory
 *   (including an ordinary exact province/city match) -> "pass".
 * - Otherwise, some allowed spec's territory merely overlaps the user's
 *   (unknown city within a matched province, or a partial administrative-
 *   transition overlap) without any spec proving a full match -> "unknown".
 */
export function matchRegion(
  residence: { province?: string; city?: string } | undefined | null,
  allowed: RegionSpec[]
): "pass" | "fail" | "unknown" {
  const province = normalizeProvince(residence?.province);
  if (!province) return "unknown";
  const city = normalizeCity(residence?.city);
  const user = { province, city };

  let sawOverlap = false;
  const overlappingSpecs: NormalizedRegion[] = [];

  for (const spec of allowed) {
    const relation = regionRelation(user, spec);
    if (relation === "contained") return "pass";
    if (relation === "overlap") {
      sawOverlap = true;
      const specProvince = normalizeProvince(spec.province);
      if (specProvince) {
        overlappingSpecs.push({ province: specProvince, city: normalizeCity(spec.city) });
      }
    }
  }

  // `allowed` is an OR list: the policy's true territory P is the UNION of
  // every allowed spec, not any single spec in isolation. A user can be
  // "overlap" against every spec individually yet still be fully covered
  // once two+ overlapping specs are combined (see adminTransition.ts).
  if (sawOverlap && transitionUnionCoversUser(user, overlappingSpecs)) return "pass";

  return sawOverlap ? "unknown" : "fail";
}
