import type { UserProfile } from "@/types/profile";

/**
 * Applicant-scope matching, verified against MOIS gov24 v3's `사용자구분`
 * field. Live-audited 2026-08-31 across the full serviceList catalog
 * (10,964 records) via `/serviceList`: distinct values were 개인 (8,967),
 * 가구 (433), 법인/시설/단체 (719), 소상공인 (231), plus `"||"`-delimited OR
 * combinations of those same four terms (e.g. "개인||가구",
 * "소상공인||법인/시설/단체"). No other tokens were observed. These are
 * standard Korean administrative applicant-category terms, not proprietary
 * codes:
 *   개인            = individual person applying on their own behalf
 *   가구            = household unit (benefit granted per-household, but an
 *                     individual person still represents/belongs to one)
 *   법인/시설/단체   = corporation / facility / organization (a legal entity,
 *                     not a natural person)
 *   소상공인        = small-business owner
 *
 * Damoa's UserProfile always models a single natural person. Per the
 * eligibility spec: a broad applicant category must not fail a narrower
 * user state, so "개인"/"가구" always PASS this dimension for any user
 * (they don't carry disqualifying information about age/income/etc. — those
 * are still separately checked by other rules). A category that resolves
 * to ONLY 법인/시설/단체 is a real, verifiable disqualifier for a personal
 * user profile (Damoa has no notion of "applying as a corporation"), so
 * that's treated as a genuine fail rather than a guess. 소상공인-only
 * requires `businessOwner` to be known.
 */
export type TargetScope = "individual" | "household" | "corporate" | "small_business_owner";

const SCOPE_BY_KOREAN_TOKEN: Record<string, TargetScope> = {
  "개인": "individual",
  "가구": "household",
  "법인/시설/단체": "corporate",
  "소상공인": "small_business_owner",
};

/**
 * Parses MOIS's `사용자구분` field into a list of `TargetScope` values.
 * Returns undefined if the field is blank OR contains any token outside the
 * four verified values above — an unrecognized token means the field's
 * real meaning for that record isn't confirmed, so no rule should be built
 * from it (fail-safe: leave unresolved rather than partially guess).
 */
export function parseMOISUserScope(raw: string | undefined | null): TargetScope[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const tokens = raw.split("||").map((t) => t.trim());
  const scopes: TargetScope[] = [];
  for (const token of tokens) {
    const scope = SCOPE_BY_KOREAN_TOKEN[token];
    if (!scope) return undefined;
    scopes.push(scope);
  }
  return scopes.length > 0 ? scopes : undefined;
}

export type TargetScopeMatch = "pass" | "fail" | "unknown";

export function matchTargetScope(profile: UserProfile, scopes: TargetScope[]): TargetScopeMatch {
  if (!scopes || scopes.length === 0) return "unknown";

  // "개인"/"가구" being present anywhere in the OR list is broad enough that
  // it doesn't restrict a personal user profile at all — pass this
  // dimension regardless of other listed scopes.
  if (scopes.includes("individual") || scopes.includes("household")) return "pass";

  // Only "소상공인"/"법인/시설/단체" remain possible from here.
  if (scopes.includes("small_business_owner")) {
    if (profile.businessOwner === true) return "pass";
    if (profile.businessOwner === false) return "fail"; // not a business owner, and corporate doesn't apply to a person either
    return "unknown";
  }

  // Only "법인/시설/단체": Damoa profiles a natural person applying for
  // themselves, never a corporate/facility/organization entity.
  if (scopes.includes("corporate")) return "fail";

  return "unknown";
}
