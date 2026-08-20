"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { REVIEW_TEXT_MAX_LENGTH } from "@/config/constants";
import { getSessionUserId } from "@/lib/auth/session";
import { getReviewRepository } from "@/lib/repositories/factory";
import { track } from "@/lib/analytics/analytics";
import type { ReportReason, ReviewTag, Visibility } from "@/types/domain";

const createReviewSchema = z.object({
  placeId: z.string().min(1),
  visitId: z.string().nullable(),
  rating: z.number().min(0.5, "별점을 선택해 주세요.").max(5),
  revisitIntention: z.enum(["definitely", "maybe", "probably_not", "no"]),
  tags: z.array(z.string()).max(6),
  reviewText: z.string().max(REVIEW_TEXT_MAX_LENGTH, "240자 이내로 작성해 주세요.").nullable(),
  visibility: z.enum(["public", "friends", "network_anonymous", "private"]),
});

export async function createReview(input: {
  placeId: string;
  visitId: string | null;
  rating: number;
  revisitIntention: "definitely" | "maybe" | "probably_not" | "no";
  tags: ReviewTag[];
  reviewText: string | null;
  visibility: Visibility;
}) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  const parsed = createReviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.");
  }

  const review = await getReviewRepository().create({
    userId,
    placeId: parsed.data.placeId,
    visitId: parsed.data.visitId,
    rating: parsed.data.rating,
    reviewText: parsed.data.reviewText,
    revisitIntention: parsed.data.revisitIntention,
    tags: parsed.data.tags as ReviewTag[],
    visibility: parsed.data.visibility,
  });

  track("review_completed", { placeId: parsed.data.placeId, visibility: parsed.data.visibility });
  revalidatePath(`/place/${parsed.data.placeId}`);
  revalidatePath("/home");
  return review;
}

export async function toggleReviewReaction(reviewId: string) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  await getReviewRepository().addReaction(reviewId, userId);
  revalidatePath("/home");
}

const reportSchema = z.object({
  reviewId: z.string().min(1),
  reason: z.enum(["misinformation", "spam", "abusive", "personal_info", "conflict_of_interest", "other"]),
  details: z.string().max(500).nullable(),
});

export async function reportReview(input: { reviewId: string; reason: ReportReason; details: string | null }) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) throw new Error("신고 정보를 확인해 주세요.");
  await getReviewRepository().report(parsed.data.reviewId, userId, parsed.data.reason, parsed.data.details);
}
