"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, PlusCircle, Bookmark, User, Users, LogOut } from "lucide-react";
import { NAV_ITEMS, APP_NAME, APP_TAGLINE } from "@/config/constants";
import { signOutAction } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import type { UserProfile } from "@/types/domain";

const ICONS = { home: Home, map: Map, add: PlusCircle, saved: Bookmark, profile: User };

/** Desktop-only left rail — replaces the mobile bottom nav at md+ breakpoints
 * and additionally surfaces Circles + the signed-in user (spec #55). */
export function SideNav({ user }: { user: UserProfile | null }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-border px-4 py-6 md:flex">
      <div>
        <div className="px-2">
          <p className="text-lg font-bold tracking-tight text-foreground">{APP_NAME}</p>
          <p className="mt-1 text-xs text-foreground-muted">{APP_TAGLINE}</p>
        </div>

        <nav className="mt-8 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = ICONS[item.key];
            const active = item.key === "profile" ? pathname.startsWith("/profile") : pathname.startsWith(`/${item.key}`);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-accent-soft text-accent" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/circles"
            className={cn(
              "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith("/circles") ? "bg-accent-soft text-accent" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            )}
          >
            <Users className="h-5 w-5" strokeWidth={pathname.startsWith("/circles") ? 2.25 : 2} />
            모임
          </Link>
        </nav>
      </div>

      {user ? (
        <div className="space-y-2 px-2">
          <Link href="/profile/me" className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-surface-muted">
            <Avatar src={user.avatarUrl} alt={user.displayName} size={32} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{user.displayName}</p>
              <p className="truncate text-xs text-foreground-muted">@{user.username}</p>
            </div>
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}
