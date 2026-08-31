"use client";

import { Bookmark } from "lucide-react";
import { useSavedBenefitStore } from "@/stores/savedBenefitStore";
import { cn } from "@/lib/utils/cn";

export function SaveButton({ benefitId, className }: { benefitId: string; className?: string }) {
  const saved = useSavedBenefitStore((s) => s.savedIds.includes(benefitId));
  const toggleSaved = useSavedBenefitStore((s) => s.toggleSaved);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(benefitId);
      }}
      aria-pressed={saved}
      aria-label={saved ? "저장한 혜택에서 제거" : "혜택 저장하기"}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground-muted transition-colors hover:bg-surface-muted",
        saved && "border-accent text-accent",
        className
      )}
    >
      <Bookmark className={cn("size-4", saved && "fill-accent")} aria-hidden="true" />
    </button>
  );
}
