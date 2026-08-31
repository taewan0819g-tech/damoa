"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { useProfileStore, useProfileHydrated } from "@/stores/profileStore";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hasHydrated = useProfileHydrated();
  const onboardingCompleted = useProfileStore((s) => s.onboardingCompleted);

  useEffect(() => {
    if (hasHydrated && !onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [hasHydrated, onboardingCompleted, router]);

  if (!hasHydrated || !onboardingCompleted) {
    return <div className="min-h-dvh bg-background" />;
  }

  return <AppShell>{children}</AppShell>;
}
