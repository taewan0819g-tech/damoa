"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, PlusCircle, Bookmark, User } from "lucide-react";
import { NAV_ITEMS } from "@/config/constants";
import { cn } from "@/lib/utils/cn";

const ICONS = { home: Home, map: Map, add: PlusCircle, saved: Bookmark, profile: User };

/** Mobile-only bottom tab bar (spec #11/#54). Hidden at desktop breakpoints
 * where the two-column layout takes over primary navigation. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      <div className="flex items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.key];
          const active = item.key === "profile" ? pathname.startsWith("/profile") : pathname.startsWith(`/${item.key}`);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-accent" : "text-foreground-muted"
              )}
            >
              <Icon className={cn("h-[22px] w-[22px]", active && "fill-accent-soft")} strokeWidth={active ? 2.25 : 2} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
