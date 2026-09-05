import type { Benefit } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";
import { PROVINCE_ALIASES, matchRegion, type RegionSpec } from "@/lib/eligibility/region";
import { getGazetteer } from "@/lib/eligibility/regionGazetteer";
import type { RegionSpecificity } from "./personalization";

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
 */
export function resolveOrganizationRegion(organization: string | undefined): RegionSpec | undefined {
  const trimmed = organization?.trim();
  if (!trimmed) return undefined;
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
