"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth/session";
import { getPrivacyRepository } from "@/lib/repositories/factory";
import type { PrivacySettings } from "@/types/domain";

export async function updatePrivacySettings(patch: Partial<Omit<PrivacySettings, "userId">>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  const updated = await getPrivacyRepository().updateSettings(userId, patch);
  revalidatePath("/settings/privacy");
  return updated;
}
