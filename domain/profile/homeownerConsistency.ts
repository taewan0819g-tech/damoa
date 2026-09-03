/**
 * `housingType === "own"` ("자가") is a logically SUFFICIENT positive
 * ownership signal for the residence being described — a person who
 * selected "자가" owns their current home, full stop. This is NOT symmetric
 * with the other `housingType` values: `"jeonse"`/`"monthly_rent"`/
 * `"living_with_family"` can NEVER be used to infer `homeowner: false`,
 * because a person can rent (or live with family in) their current
 * residence while owning a separate property elsewhere — non-own tenure
 * says nothing about ownership status in general, only "own" does.
 *
 * This function therefore only ever pushes `homeowner` in the TRUE
 * direction (or leaves it alone) — it never sets `homeowner` to `false` or
 * `undefined`, and never fires for any `housingType` other than `"own"`.
 * Applied uniformly at every write path that can produce a profile
 * (onboarding `finish()`, the profile-edit page, `profileStore`'s
 * `updateProfile`/`setProfile`/persisted-storage rehydration, and
 * `parseUserProfile` for externally-supplied profiles) so a contradictory
 * `{ housingType: "own", homeowner: false }` profile can never exist,
 * regardless of which write path produced it.
 */
export function normalizeHomeownerConsistency<T extends { housingType?: string; homeowner?: boolean }>(
  profile: T
): T {
  if (profile.housingType === "own" && profile.homeowner !== true) {
    return { ...profile, homeowner: true };
  }
  return profile;
}
