import type { ReviewBreakdown, SafeReview } from "@/types/domain";

/**
 * Aggregate, identity-free "what people used this place for" percentages
 * (spec #74). Computed only from the viewer's already-privacy-filtered
 * SafeReview set, so it can never surface a percentage derived from content
 * the viewer isn't allowed to see. `value` has no direct tag equivalent in
 * SafeReview, so it's approximated from revisit intention ("definitely" ==
 * felt worth going back to) rather than the raw price/noise/wait ratings,
 * which aren't part of the safe, anonymity-preserving review shape.
 */
export function computeReviewBreakdown(reviews: SafeReview[]): ReviewBreakdown | null {
  if (reviews.length === 0) return null;
  const pct = (count: number) => Math.round((count / reviews.length) * 100);
  return {
    date: pct(reviews.filter((r) => r.tags.includes("date")).length),
    friends: pct(reviews.filter((r) => r.tags.includes("friends")).length),
    solo: pct(reviews.filter((r) => r.tags.includes("solo")).length),
    family: pct(reviews.filter((r) => r.tags.includes("family")).length),
    quiet: pct(reviews.filter((r) => r.tags.includes("quiet_talk")).length),
    value: pct(reviews.filter((r) => r.revisitIntention === "definitely").length),
  };
}
