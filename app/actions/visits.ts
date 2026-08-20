"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getVisitRepository } from "@/lib/repositories/factory";
import { track } from "@/lib/analytics/analytics";
import type { Visit } from "@/types/domain";

const createVisitSchema = z.object({
  placeId: z.string().min(1, "장소를 선택해 주세요."),
  visitedAt: z.string().min(1),
  visibility: z.enum(["public", "friends", "network_anonymous", "private"]),
});

export interface CreateVisitState {
  error: string | null;
}

export async function createVisit(input: { placeId: string; visitedAt: string; visibility: Visit["visibility"] }) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  const parsed = createVisitSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.");
  }

  const visit = await getVisitRepository().create({ userId, ...parsed.data });
  track("visit_created", { placeId: parsed.data.placeId });

  revalidatePath("/home");
  revalidatePath("/profile/me");
  revalidatePath(`/place/${parsed.data.placeId}`);
  return visit;
}
