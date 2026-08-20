"use client";

import { useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { RecommendationReason } from "@/types/domain";

/** Explains the recommendation in plain language — never exposes the raw
 * scoring weights, only the human-readable reasons (spec #24/#69). */
export function WhyRecommended({ reasons }: { reasons: RecommendationReason[] }) {
  const [open, setOpen] = useState(false);
  if (reasons.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface-muted/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-accent" />
          왜 추천됐나요?
        </span>
        <ChevronDown className={cn("h-4 w-4 text-foreground-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="space-y-1.5 px-4 pb-4">
          {reasons.map((reason) => (
            <li key={reason.code} className="flex items-start gap-2 text-sm text-foreground-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {reason.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
