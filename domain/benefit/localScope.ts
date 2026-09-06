import type { Benefit } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { PROVINCE_ALIASES, matchRegion, type RegionSpec } from "@/lib/eligibility/region";
import { getGazetteer } from "@/lib/eligibility/regionGazetteer";
import type { RegionSpecificity } from "./personalization";

/** Structured admin-name suffix for provincial/metropolitan education offices — see the block below. */
const EDUCATION_OFFICE_SUFFIX = "교육청";

/**
 * The FULL canonical (or historically-full, pre-rename) province/metro
 * administrative names that the "<province>교육청" pattern below is allowed
 * to match against — deliberately a hand-picked subset of
 * `PROVINCE_ALIASES`' keys, NOT every key in that table. `PROVINCE_ALIASES`
 * also contains short abbreviated surface forms (e.g. "경기" -> "경기도",
 * "서울" -> "서울특별시", "전북" -> "전북특별자치도") that exist for normalizing
 * free-text province mentions elsewhere in the app, but the frozen-catalog
 * audit backing this pattern only ever observed FULL official names in real
 * 소관기관명 values (e.g. "경기도교육청", never "경기교육청") — so the education
 * -office pattern must reject the abbreviated forms even though
 * `PROVINCE_ALIASES` itself could normalize them. Historically-full official
 * names that predate a special-autonomous-province rename (e.g. "강원도",
 * "제주도", "전라북도" before their 강원특별자치도/제주특별자치도/전북특별자치도
 * renames) are intentionally kept here — they're full names, not
 * abbreviations, even though they're no longer the current canonical form —
 * consistent with the historical-transition recognition
 * `lib/eligibility/region.ts` already applies elsewhere.
 */
const FULL_PROVINCE_NAMES = new Set<string>([
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전라북도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주도",
  "제주특별자치도",
  "전남광주통합특별시",
]);

/**
 * Parses a benefit's PUBLISHING organization name (`source.organization`,
 * e.g. "경상남도", "경기도 평택시", "국토교통부") into a `RegionSpec` — exact-match
 * only, same philosophy as `lib/eligibility/region.ts`: never guesses, only
 * recognizes an unambiguous province name.
 *
 * Deliberately checks the first whitespace-separated TOKEN against the
 * canonical province alias table (not a substring/contains check) so a
 * private/institutional name that merely starts with a place-sounding
 * syllable (e.g. "서울보증보험") can never be misread as a province — it
 * would have to be the exact standalone token "서울"/"서울시"/"서울특별시" etc.
 * Returns `undefined` when the organization name carries no recognizable
 * province token at all (e.g. a central ministry like "국토교통부") — those
 * are treated as having no local-scope signal, never as a false conflict.
 *
 * One additional, deliberately narrow structured pattern is checked FIRST:
 * "<FULL province name>교육청" with NO separator (e.g. "경기도교육청",
 * "서울특별시교육청", "전북특별자치도교육청", "전남광주통합특별시교육청") — the
 * exact 소관기관명 shape of every one of the 261 MOIS 소관기관유형="교육청"
 * records (see `MOISAdapter.mapInstitutionType`'s audit note), which never
 * contain a space and so are otherwise invisible to the whitespace-token
 * check above. This match requires the ENTIRE remainder after stripping the
 * "교육청" suffix to be an exact match against `FULL_PROVINCE_NAMES` — a
 * deliberately narrower set than `PROVINCE_ALIASES`' full key list, since
 * that table also contains short abbreviated forms ("경기", "서울", "전북",
 * etc.) that the frozen-catalog audit never observed in a real 소관기관명
 * (every one of the 16 audited names uses the full official — or
 * historically-full pre-rename — province name, never an abbreviation). So
 * "경기도교육청"/"서울특별시교육청"/"전북특별자치도교육청" resolve, but
 * "경기교육청"/"서울교육청"/"전북교육청" deliberately do NOT — never a
 * substring or partial match, and never resolved merely because
 * `PROVINCE_ALIASES` itself could normalize the abbreviation. It deliberately
 * does NOT infer locality from a name merely ending in "교육청" for any other
 * reason, and does NOT attempt city-level 교육지원청 names (none exist in the
 * audited catalog; see Phase 3 of the eligibility-precision audit for the
 * explicit decision to leave embedded-city-name parsing, e.g.
 * "재단법인목포인재육성재단", unresolved rather than guessed).
 *
 * Verified NON-matches (collision regression coverage): "서울대학교병원",
 * "인천국제공항공사", "강원랜드", "한국장학재단" — none carry a bare province
 * token as their first whitespace-delimited token, and none end in the
 * "교육청" suffix, so all four correctly remain unresolved (`undefined`)
 * rather than being misread as locally scoped.
 */
export function resolveOrganizationRegion(organization: string | undefined): RegionSpec | undefined {
  const trimmed = organization?.trim();
  if (!trimmed) return undefined;

  if (trimmed.endsWith(EDUCATION_OFFICE_SUFFIX)) {
    const provincePart = trimmed.slice(0, -EDUCATION_OFFICE_SUFFIX.length);
    if (FULL_PROVINCE_NAMES.has(provincePart)) {
      const province = PROVINCE_ALIASES[provincePart];
      if (province) return { province };
    }
  }

  const spaceIdx = trimmed.indexOf(" ");
  const firstToken = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const province = PROVINCE_ALIASES[firstToken];
  if (!province) return undefined;
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  if (!rest) return { province };
  const cities = getGazetteer()[province] ?? [];
  return cities.includes(rest) ? { province, city: rest } : { province };
}

/**
 * Home-recommended-only precision gate (see docs on `getRecommendedBenefits`'
 * `excludeWeakUnknown`). Flags a benefit whose publishing organization is
 * structurally local to a place that conflicts with — or is unverified
 * against — the profile's residence, even though the deterministic rule
 * engine never got a resolvable `region_in` rule to fail it on (so status
 * stays "unknown", never "not_eligible" — this never touches eligibility).
 *
 * Requires TWO independent structured signals to agree before ever flagging
 * anything, specifically to avoid a title/name-token false positive (e.g. a
 * private institution whose name happens to start with a place-sounding
 * word) acting alone:
 *   1. `institution.type === "local_government"` — the SOURCE's own
 *      classification of itself as a province/city government (see
 *      `mapInstitutionType` in the MOIS/Youth adapters, driven by the raw
 *      소관기관유형/organization-shape data, not this module's own parsing).
 *   2. `resolveOrganizationRegion` recognizing an exact province token in
 *      that same organization's name.
 *
 * Never flags:
 *  - a benefit already verified `exact_city` compatible (a real region_in
 *    rule PASSED at city granularity — nothing left to be unresolved about).
 *  - a benefit whose institution isn't classified as local government at all
 *    (central ministries, financial institutions, national corporations).
 *  - a benefit whose organization carries no recognizable province token
 *    even though it IS locally classified (an organization name shape this
 *    module doesn't yet parse — falls back to leaving it recommended rather
 *    than guessing).
 *
 * Flags (demote to Home `needsReview`, never `not_eligible`, never removed
 * from full `/benefits` discovery):
 *  - `regionSpecificity === "none"` (no region rule resolved at all) with an
 *    organization region that FAILS `matchRegion` against the profile — e.g.
 *    a 경상남도-published benefit for an 경기도 이천시 profile whose applicant
 *    text ("도내 주민등록...") couldn't be safely resolved into a rule.
 *  - `regionSpecificity === "province"` (a real rule passed, but only at
 *    province granularity) where the organization is itself scoped to a
 *    DIFFERENT city in the same province than matchRegion would need — the
 *    parsed residence evidence is broader than what the publishing org's own
 *    scope would verify.
 */
export function hasUnresolvedLocalScopeConflict(
  benefit: Benefit,
  profile: UserProfile,
  regionSpecificity: RegionSpecificity
): boolean {
  if (regionSpecificity === "exact_city") return false;
  if (benefit.institution?.type !== "local_government") return false;
  const orgRegion = resolveOrganizationRegion(benefit.source?.organization);
  if (!orgRegion) return false;
  return matchRegion(profile.residence, [orgRegion]) !== "pass";
}
