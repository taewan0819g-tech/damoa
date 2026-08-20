import type { Review, UUID } from "@/types/domain";
import type { CreateReviewInput, ReviewRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

export class DemoReviewRepository implements ReviewRepository {
  async getById(id: UUID): Promise<Review | null> {
    return demoStore.reviews.find((r) => r.id === id) ?? null;
  }

  async getByPlace(placeId: UUID): Promise<Review[]> {
    return demoStore.reviews.filter((r) => r.placeId === placeId);
  }

  async getByUser(userId: UUID): Promise<Review[]> {
    return demoStore.reviews.filter((r) => r.userId === userId);
  }

  async create(input: CreateReviewInput): Promise<Review> {
    const now = new Date().toISOString();
    const review: Review = {
      id: demoStore.nextId("r"),
      userId: input.userId,
      placeId: input.placeId,
      visitId: input.visitId,
      rating: input.rating,
      reviewText: input.reviewText,
      revisitIntention: input.revisitIntention,
      priceRating: null,
      noiseRating: null,
      waitRating: null,
      tags: input.tags,
      visibility: input.visibility,
      createdAt: now,
      updatedAt: now,
    };
    demoStore.reviews.unshift(review);
    return review;
  }

  async addReaction(reviewId: UUID, userId: UUID): Promise<void> {
    const existing = demoStore.reactions.find((r) => r.reviewId === reviewId && r.userId === userId);
    if (existing) {
      demoStore.reactions = demoStore.reactions.filter((r) => r !== existing);
      return;
    }
    demoStore.reactions.push({ id: demoStore.nextId("react"), userId, reviewId });
  }

  async getHelpfulCount(reviewId: UUID): Promise<number> {
    return demoStore.reactions.filter((r) => r.reviewId === reviewId).length;
  }

  async hasReacted(reviewId: UUID, userId: UUID): Promise<boolean> {
    return demoStore.reactions.some((r) => r.reviewId === reviewId && r.userId === userId);
  }

  async report(reviewId: UUID, reporterId: UUID, reason: string, details: string | null): Promise<void> {
    demoStore.reports.push({
      id: demoStore.nextId("report"),
      reporterId,
      reviewId,
      reason,
      details,
      createdAt: new Date().toISOString(),
    });
  }
}
