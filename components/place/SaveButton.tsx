"use client";

import { useState, useTransition } from "react";
import { Bookmark } from "lucide-react";
import { toggleSavePlace } from "@/app/actions/places";
import { cn } from "@/lib/utils/cn";

export function SaveButton({ placeId, initialSaved, variant = "button" }: { placeId: string; initialSaved: boolean; variant?: "button" | "icon" }) {
  const [saved, setSaved] = useState(initialSaved);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSaved((s) => !s);
    startTransition(async () => {
      try {
        const result = await toggleSavePlace(placeId);
        setSaved(result.saved);
      } catch {
        setSaved((s) => !s);
      }
    });
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label={saved ? "저장 취소" : "저장"}
        aria-pressed={saved}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 backdrop-blur shadow-sm transition-colors",
          saved ? "text-accent" : "text-foreground-muted hover:text-foreground"
        )}
      >
        <Bookmark className={cn("h-4 w-4", saved && "fill-accent")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={saved}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
        saved ? "border-accent bg-accent-soft text-accent" : "border-border text-foreground-muted hover:border-accent/40"
      )}
    >
      <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-accent")} />
      {saved ? "저장됨" : "저장"}
    </button>
  );
}
