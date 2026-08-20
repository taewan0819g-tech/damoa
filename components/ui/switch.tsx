"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils/cn";

export function Switch({
  checked,
  onCheckedChange,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full bg-surface-muted transition-colors data-[state=checked]:bg-accent",
        className
      )}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
    </SwitchPrimitive.Root>
  );
}
