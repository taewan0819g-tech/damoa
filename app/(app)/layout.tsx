import { redirect } from "next/navigation";
import { getCurrentUser, getSessionUserId, hasCompletedOnboarding } from "@/lib/auth/session";
import { getNotificationRepository } from "@/lib/repositories/factory";
import { TopBar } from "@/components/navigation/TopBar";
import { BottomNav } from "@/components/navigation/BottomNav";
import { SideNav } from "@/components/navigation/SideNav";

/**
 * Shared shell for every authenticated route: guards session + onboarding,
 * then renders the mobile bottom nav or desktop side rail (spec #11/#54/#55)
 * around a shared centered content column.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const onboarded = await hasCompletedOnboarding();
  if (!onboarded) redirect("/onboarding");

  const [user, notifications] = await Promise.all([getCurrentUser(), getNotificationRepository().getByUser(userId)]);
  const unreadNotifications = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex max-w-6xl">
        <SideNav user={user} />
        <div className="min-h-dvh w-full flex-1 md:border-x md:border-border">
          <div className="mx-auto max-w-2xl">
            <TopBar unreadNotifications={unreadNotifications} />
            <main className="pb-24 md:pb-10">{children}</main>
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
