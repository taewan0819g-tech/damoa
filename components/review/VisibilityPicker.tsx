"use client";

import { Eye, Users, EyeOff, Lock } from "lucide-react";
import { VISIBILITY_LABELS, VISIBILITY_DESCRIPTIONS } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils/cn";
import type { Visibility } from "@/types/domain";

const OPTIONS: Visibility[] = ["public", "friends", "network_anonymous", "private"];
const ICONS: Record<Visibility, typeof Eye> = { public: Eye, friends: Users, network_anonymous: EyeOff, private: Lock };

/** Every write flow (visit + review) reuses this so visibility semantics
 * never drift between the two (spec #15/#16/#77). */
export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (value: Visibility) => void }) {
  return (
    <div className="space-y-2">
      {OPTIONS.map((option) => {
        const Icon = ICONS[option];
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
              active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/40"
            )}
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-accent" : "text-foreground-muted")} />
            <div>
              <p className="text-sm font-semibold text-foreground">{VISIBILITY_LABELS[option]}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">{VISIBILITY_DESCRIPTIONS[option]}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
