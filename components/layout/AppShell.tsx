import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-background pb-24">
      <div className="px-4 pt-6">{children}</div>
      <BottomNav />
    </div>
  );
}
