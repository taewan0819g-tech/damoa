import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile } from "@/types/profile";
import { normalizeHomeownerConsistency } from "@/domain/profile/homeownerConsistency";

interface ProfileState {
  profile: UserProfile;
  onboardingCompleted: boolean;
  updateProfile: (patch: Partial<UserProfile>) => void;
  setProfile: (profile: UserProfile) => void;
  completeOnboarding: () => void;
  resetProfile: () => void;
}

const EMPTY_PROFILE: UserProfile = {};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profile: EMPTY_PROFILE,
      onboardingCompleted: false,
      // normalizeHomeownerConsistency is applied on every write path (here,
      // setProfile below, and the persisted-storage `merge` below) so a
      // contradictory `{ housingType: "own", homeowner: false }` profile can
      // never exist regardless of which path produced it — see
      // domain/profile/homeownerConsistency.ts.
      updateProfile: (patch) =>
        set((state) => ({ profile: normalizeHomeownerConsistency({ ...state.profile, ...patch }) })),
      setProfile: (profile) => set({ profile: normalizeHomeownerConsistency(profile) }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      resetProfile: () => set({ profile: EMPTY_PROFILE, onboardingCompleted: false }),
    }),
    {
      name: "damoa-profile",
      partialize: (state) => ({ profile: state.profile, onboardingCompleted: state.onboardingCompleted }),
      // Corrupted localStorage payloads fall back to defaults instead of throwing during hydration.
      // Also normalizes homeowner/housingType consistency on rehydration, so
      // an already-persisted contradictory profile (e.g. saved by an older
      // build, or edited directly in localStorage) self-heals on next load.
      merge: (persisted, current) => {
        try {
          if (persisted && typeof persisted === "object") {
            const merged = { ...current, ...(persisted as Partial<ProfileState>) };
            return { ...merged, profile: normalizeHomeownerConsistency(merged.profile) };
          }
        } catch {
          // fall through to defaults
        }
        return current;
      },
    }
  )
);

/**
 * Tracks whether the persisted profile store has finished rehydrating from
 * localStorage. Uses zustand's own `persist.hasHydrated()` / `onFinishHydration`
 * APIs instead of a plain state field, since a hydration flag stored inside the
 * state itself can be clobbered by the middleware's internal replace-on-hydrate
 * step depending on call ordering.
 */
export function useProfileHydrated(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => useProfileStore.persist.onFinishHydration(onStoreChange),
    () => useProfileStore.persist.hasHydrated(),
    () => false
  );
}
