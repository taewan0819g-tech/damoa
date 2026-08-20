import { redirect } from "next/navigation";
import { getSessionUserId, hasCompletedOnboarding } from "@/lib/auth/session";

export default async function RootPage() {
  const uid = await getSessionUserId();
  if (!uid) redirect("/login");
  const onboarded = await hasCompletedOnboarding();
  redirect(onboarded ? "/home" : "/onboarding");
}
