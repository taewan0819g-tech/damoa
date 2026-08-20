import { redirect } from "next/navigation";
import { getSessionUserId, hasCompletedOnboarding } from "@/lib/auth/session";
import { getSocialRepository } from "@/lib/repositories/factory";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

export default async function OnboardingPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (await hasCompletedOnboarding()) redirect("/home");

  const [allUsers, relationships] = await Promise.all([
    getSocialRepository().listUsers(),
    getSocialRepository().getRelationships(userId),
  ]);
  const connectedIds = new Set(relationships.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)));
  const suggestions = allUsers.filter((u) => u.id !== userId && !connectedIds.has(u.id)).slice(0, 6);

  return (
    <div className="mx-auto min-h-dvh max-w-sm px-6 py-10">
      <OnboardingFlow suggestions={suggestions} />
    </div>
  );
}
