"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A polished mobile bottom sheet used for map pin details and quick actions
 * (spec #11). Built on Radix Dialog for focus-trapping/escape/overlay
 * behavior, styled to slide up from the bottom rather than center.
 */
export function BottomSheet({
  open,
  onOpenChange,
  children,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-2xl",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
            "safe-bottom sm:bottom-6 sm:rounded-3xl"
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" aria-hidden />
          {children}
          <DialogPrimitive.Close
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-foreground-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
