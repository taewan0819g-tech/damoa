import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile } from "@/types/profile";

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
      updateProfile: (patch) => set((state) => ({ profile: { ...state.profile, ...patch } })),
      setProfile: (profile) => set({ profile }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      resetProfile: () => set({ profile: EMPTY_PROFILE, onboardingCompleted: false }),
    }),
    {
      name: "damoa-profile",
      partialize: (state) => ({ profile: state.profile, onboardingCompleted: state.onboardingCompleted }),
      // Corrupted localStorage payloads fall back to defaults instead of throwing during hydration.
      merge: (persisted, current) => {
        try {
          if (persisted && typeof persisted === "object") {
            return { ...current, ...(persisted as Partial<ProfileState>) };
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
