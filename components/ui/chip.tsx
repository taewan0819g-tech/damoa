import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ className, selected, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
        selected
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-surface text-foreground-muted hover:bg-surface-muted",
        className
      )}
      {...props}
    />
  );
}
