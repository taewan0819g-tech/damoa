import Link from "next/link";
import { Bell, Settings } from "lucide-react";
import { APP_NAME } from "@/config/constants";

/** Shared top bar: brand + notifications/settings entry points. Desktop nav
 * links live in the two-column shell, not here, to avoid duplicating them. */
export function TopBar({ unreadNotifications = 0 }: { unreadNotifications?: number }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link href="/home" className="text-lg font-bold tracking-tight text-foreground">
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            aria-label="알림"
          >
            <Bell className="h-5 w-5" />
            {unreadNotifications > 0 ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
            ) : null}
          </Link>
          <Link
            href="/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            aria-label="설정"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
