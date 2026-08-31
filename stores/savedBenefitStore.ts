import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SavedBenefitState {
  savedIds: string[];
  toggleSaved: (benefitId: string) => void;
  isSaved: (benefitId: string) => boolean;
}

export const useSavedBenefitStore = create<SavedBenefitState>()(
  persist(
    (set, get) => ({
      savedIds: [],
      toggleSaved: (benefitId) =>
        set((state) => ({
          savedIds: state.savedIds.includes(benefitId)
            ? state.savedIds.filter((id) => id !== benefitId)
            : [...state.savedIds, benefitId],
        })),
      isSaved: (benefitId) => get().savedIds.includes(benefitId),
    }),
    {
      name: "damoa-saved-benefits",
      merge: (persisted, current) => {
        try {
          const savedIds = (persisted as { savedIds?: unknown })?.savedIds;
          if (Array.isArray(savedIds) && savedIds.every((id) => typeof id === "string")) {
            return { ...current, savedIds };
          }
        } catch {
          // fall through to defaults
        }
        return current;
      },
    }
  )
);
