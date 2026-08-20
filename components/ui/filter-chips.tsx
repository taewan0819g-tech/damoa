"use client";

import { cn } from "@/lib/utils/cn";

export interface ChipOption<T extends string = string> {
  value: T;
  label: string;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto scrollbar-none", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
            value === opt.value
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border bg-surface text-foreground-muted hover:border-accent/40"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
