/**
 * Hierarchical Korean administrative-region matching used by the
 * `region_in` rule operator. Deliberately NOT fuzzy: only the explicit
 * alias table below normalizes province names (e.g. "경기" / "경기도" both
 * mean the same province). Cities/districts are compared by exact string
 * equality after trimming — no substring or edit-distance matching — so a
 * benefit can never silently match the wrong city.
 */

export interface RegionSpec {
  /** Province/metropolitan-city name, e.g. "경기도", "서울특별시". */
  province: string;
  /** City/county/district name. Omit to allow the whole province. */
  city?: string;
}

const PROVINCE_ALIASES: Record<string, string> = {
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
};

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
 * Matches a user's residence against an OR'd list of allowed regions.
 *
 * - No residence info at all -> "unknown" (can't rule it in or out).
 * - Province known but doesn't appear in `allowed` at all -> "fail".
 * - Province matches a spec that allows the whole province -> "pass".
 * - Province matches a spec that requires a specific city:
 *   - city unknown -> "unknown" (could still be the right city)
 *   - city known and matches -> "pass"
 *   - city known and never matches any allowed city in that province -> "fail"
 */
export function matchRegion(
  residence: { province?: string; city?: string } | undefined | null,
  allowed: RegionSpec[]
): "pass" | "fail" | "unknown" {
  const province = normalizeProvince(residence?.province);
  if (!province) return "unknown";
  const city = normalizeCity(residence?.city);

  let cityUnknownWithinMatchedProvince = false;

  for (const spec of allowed) {
    const specProvince = normalizeProvince(spec.province);
    if (!specProvince || specProvince !== province) continue;
    if (!spec.city) return "pass";
    if (!city) {
      cityUnknownWithinMatchedProvince = true;
      continue;
    }
    if (normalizeCity(spec.city) === city) return "pass";
  }

  if (cityUnknownWithinMatchedProvince) return "unknown";
  return "fail";
}
