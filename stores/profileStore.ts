import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile } from "@/types/profile";

interface ProfileState {
  profile: UserProfile;
  onboardingCompleted: boolean;
  hasHydrated: boolean;
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
      hasHydrated: false,
      updateProfile: (patch) => set((state) => ({ profile: { ...state.profile, ...patch } })),
      setProfile: (profile) => set({ profile }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      resetProfile: () => set({ profile: EMPTY_PROFILE, onboardingCompleted: false }),
    }),
    {
      name: "damoa-profile",
      partialize: (state) => ({ profile: state.profile, onboardingCompleted: state.onboardingCompleted }),
      onRehydrateStorage: () => () => {
        useProfileStore.setState({ hasHydrated: true });
      },
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
