"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth/session";
import { getSocialRepository } from "@/lib/repositories/factory";
import { track } from "@/lib/analytics/analytics";

export async function addFriend(targetUserId: string) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  await getSocialRepository().addFriend(userId, targetUserId);
  track("friend_added", { targetUserId });
  revalidatePath("/circles");
  revalidatePath("/onboarding");
}
