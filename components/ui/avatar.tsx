"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils/cn";

export function Avatar({
  className,
  src,
  alt,
  fallback,
  size = 36,
}: {
  className?: string;
  src?: string | null;
  alt: string;
  fallback?: string;
  size?: number;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full bg-surface-muted ring-2 ring-surface", className)}
      style={{ width: size, height: size }}
    >
      {src ? <AvatarPrimitive.Image src={src} alt={alt} className="h-full w-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center bg-accent-soft text-accent font-semibold"
        style={{ fontSize: size * 0.4 }}
        delayMs={src ? 400 : 0}
      >
        {fallback ?? alt.slice(0, 1)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
