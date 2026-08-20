"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { ReactNode } from "react";
import { markNotificationRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils/cn";

export function NotificationItem({
  id,
  href,
  message,
  timeLabel,
  unread,
  icon,
}: {
  id: string;
  href: string;
  message: string;
  timeLabel: string;
  unread: boolean;
  icon: ReactNode;
}) {
  const [, startTransition] = useTransition();

  return (
    <Link
      href={href}
      onClick={() => {
        if (unread) startTransition(() => markNotificationRead(id));
      }}
      className={cn("flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-surface-muted", unread && "bg-accent-soft/40")}
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-accent">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", unread ? "font-medium text-foreground" : "text-foreground-muted")}>{message}</p>
        <p className="mt-0.5 text-xs text-foreground-muted">{timeLabel}</p>
      </div>
      {unread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
    </Link>
  );
}
