import { describe, expect, it } from "vitest";
import { computeReviewBreakdown } from "@/lib/reviews/breakdown";
import type { SafeReview } from "@/types/domain";

function safeReview(overrides: Partial<SafeReview>): SafeReview {
  return {
    id: "r1",
    placeId: "p1",
    rating: 4,
    text: null,
    revisitIntention: "maybe",
    tags: [],
    visibility: "friends",
    displayIdentity: "친구 네트워크 사용자",
    author: null,
    approximateTime: new Date().toISOString(),
    isAnonymous: false,
    helpfulCount: 0,
    viewerFoundHelpful: false,
    canModerate: true,
    ...overrides,
  };
}

describe("computeReviewBreakdown", () => {
  it("returns null when there is nothing to summarize (never fabricates a breakdown from zero reviews)", () => {
    expect(computeReviewBreakdown([])).toBeNull();
  });

  it("computes tag percentages relative to the full review count, not just tagged reviews", () => {
    const reviews = [
      safeReview({ tags: ["date"], revisitIntention: "definitely" }),
      safeReview({ tags: ["friends"], revisitIntention: "maybe" }),
      safeReview({ tags: [], revisitIntention: "no" }),
      safeReview({ tags: ["date", "friends"], revisitIntention: "definitely" }),
    ];
    const breakdown = computeReviewBreakdown(reviews)!;
    expect(breakdown.date).toBe(50); // 2 of 4
    expect(breakdown.friends).toBe(50); // 2 of 4
    expect(breakdown.solo).toBe(0);
    expect(breakdown.value).toBe(50); // 2 of 4 said "definitely"
  });

  it("only draws on the SafeReview fields the viewer is actually allowed to see", () => {
    // SafeReview has no priceRating/noiseRating — computeReviewBreakdown's
    // `value` field must come from revisitIntention, not raw ratings that
    // were never exposed to the client in the first place.
    const reviews = [safeReview({ revisitIntention: "definitely" })];
    const breakdown = computeReviewBreakdown(reviews)!;
    expect(breakdown.value).toBe(100);
  });
});
