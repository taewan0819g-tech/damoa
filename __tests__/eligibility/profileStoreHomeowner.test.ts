import { describe, expect, it } from "vitest";
import { useProfileStore } from "@/stores/profileStore";

/**
 * `profileStore`'s `updateProfile`/`setProfile` write paths apply
 * `normalizeHomeownerConsistency` on every write (see stores/profileStore.ts
 * doc comment), so a contradictory `{ housingType: "own", homeowner: false }`
 * profile can never exist in the store regardless of which patch produced it.
 */
describe("profileStore homeowner consistency", () => {
  it("updateProfile({ housingType: 'own' }) forces homeowner true even without an explicit homeowner patch", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ housingType: "own" });
    expect(useProfileStore.getState().profile.homeowner).toBe(true);
  });

  it("updateProfile changing away from 'own' does NOT force homeowner back to false", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ housingType: "own" });
    expect(useProfileStore.getState().profile.homeowner).toBe(true);

    useProfileStore.getState().updateProfile({ housingType: "jeonse" });
    // Still true — non-own tenure can never disprove ownership of a
    // separate property, so the previous true is left untouched.
    expect(useProfileStore.getState().profile.homeowner).toBe(true);
  });

  it("setProfile with a contradictory profile is normalized on write", () => {
    useProfileStore.getState().setProfile({ housingType: "own", homeowner: false });
    expect(useProfileStore.getState().profile.homeowner).toBe(true);
  });

  it("updateProfile with a non-own housingType never sets homeowner to false when it was previously undefined", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ housingType: "monthly_rent" });
    expect(useProfileStore.getState().profile.homeowner).toBeUndefined();
  });
});
