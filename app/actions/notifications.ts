"use server";

import { revalidatePath } from "next/cache";
import { getNotificationRepository } from "@/lib/repositories/factory";

export async function markNotificationRead(notificationId: string) {
  await getNotificationRepository().markRead(notificationId);
  revalidatePath("/notifications");
}
