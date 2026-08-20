import { NETWORK_QUALITY_PRIOR, RECOMMENDATION_WEIGHTS, SOCIAL_PROXIMITY_WEIGHTS } from "@/config/ranking";
import type { RecommendationReason, Review, SocialDistance } from "@/types/domain";
import { recencyScore } from "@/lib/ranking/decay";

/**
 * Pure scoring functions — no repository access, so they're easy to unit
 * test and safe to call from either the Demo or Supabase code paths.
 *
 * RecommendationScore =
 *   0.35 * SocialProximity + 0.25 * Recency + 0.20 * TasteSimilarity
 *   + 0.15 * NetworkQuality + 0.05 * Novelty
 */

export function socialProximityScore(distance: SocialDistance): number {
  switch (distance) {
    case "self":
    case "direct_friend":
      return SOCIAL_PROXIMITY_WEIGHTS.directFriend;
    case "friend_of_friend":
      return SOCIAL_PROXIMITY_WEIGHTS.friendOfFriend;
    case "shared_circle":
      return SOCIAL_PROXIMITY_WEIGHTS.sharedCircle;
    case "network":
      return SOCIAL_PROXIMITY_WEIGHTS.generalNetwork;
    default:
      return SOCIAL_PROXIMITY_WEIGHTS.none;
  }
}

export function bestRecencyScore(visitDates: string[]): number {
  if (visitDates.length === 0) return 0;
  return Math.max(...visitDates.map((d) => recencyScore(d)));
}

/**
 * Bayesian/shrinkage-adjusted network rating (spec #33/#107): a single
 * 5-star review should not outrank a place with many consistently-good
 * reviews. Returns both the adjusted rating (0-5) and a normalized 0-1
 * quality score for the recommendation formula.
 */
export function networkQuality(ratings: number[]): { adjustedRating: number | null; normalized: number; sampleSize: number } {
  const sampleSize = ratings.length;
  if (sampleSize === 0) return { adjustedRating: null, normalized: NETWORK_QUALITY_PRIOR.priorMean / 5, sampleSize: 0 };
  const { priorMean, priorWeight } = NETWORK_QUALITY_PRIOR;
  const sum = ratings.reduce((a, b) => a + b, 0);
  const adjustedRating = (priorWeight * priorMean + sum) / (priorWeight + sampleSize);
  return { adjustedRating: Math.round(adjustedRating * 10) / 10, normalized: adjustedRating / 5, sampleSize };
}

export function noveltyScore(hasViewerVisited: boolean, hasViewerSaved: boolean): number {
  if (hasViewerVisited) return 0;
  if (hasViewerSaved) return 0.4;
  return 1;
}

export interface RecommendationInputs {
  socialDistanceOfVisitors: SocialDistance[];
  visitDates: string[];
  tasteSimilarity: number; // 0-1
  ratings: number[];
  hasViewerVisited: boolean;
  hasViewerSaved: boolean;
}

export interface RecommendationResult {
  score: number;
  components: {
    socialProximity: number;
    recency: number;
    tasteSimilarity: number;
    networkQuality: number;
    novelty: number;
  };
}

export function computeRecommendationScore(inputs: RecommendationInputs): RecommendationResult {
  const socialProximity = Math.max(0, ...inputs.socialDistanceOfVisitors.map(socialProximityScore), 0);
  const recency = bestRecencyScore(inputs.visitDates);
  const { normalized: networkQualityScore } = networkQuality(inputs.ratings);
  const novelty = noveltyScore(inputs.hasViewerVisited, inputs.hasViewerSaved);

  const score =
    RECOMMENDATION_WEIGHTS.socialProximity * socialProximity +
    RECOMMENDATION_WEIGHTS.recency * recency +
    RECOMMENDATION_WEIGHTS.tasteSimilarity * inputs.tasteSimilarity +
    RECOMMENDATION_WEIGHTS.networkQuality * networkQualityScore +
    RECOMMENDATION_WEIGHTS.novelty * novelty;

  return {
    score: Math.round(score * 1000) / 1000,
    components: { socialProximity, recency, tasteSimilarity: inputs.tasteSimilarity, networkQuality: networkQualityScore, novelty },
  };
}

/** Human-readable "why this place?" reasons (spec #34/#108) — never expose raw weights to users. */
export function generateReasons(params: {
  friendVisitCount: number;
  recentFriendVisitCount: number;
  tasteSimilarity: number;
  circleTrend: boolean;
  quietTasteMatch: boolean;
}): RecommendationReason[] {
  const reasons: RecommendationReason[] = [];
  if (params.recentFriendVisitCount > 0) {
    reasons.push({
      code: "recent_friend_visits",
      label: `최근 친구 ${params.recentFriendVisitCount}명이 방문했어요.`,
    });
  } else if (params.friendVisitCount > 0) {
    reasons.push({ code: "friend_visits", label: `친구 ${params.friendVisitCount}명이 다녀왔어요.` });
  }
  if (params.tasteSimilarity > 0.6) {
    reasons.push({ code: "taste_match", label: "취향이 비슷한 사람들이 높게 평가했어요." });
  }
  if (params.circleTrend) {
    reasons.push({ code: "circle_trend", label: "학교 지인들 사이에서 최근 방문이 늘고 있어요." });
  }
  if (params.quietTasteMatch) {
    reasons.push({ code: "quiet_match", label: "조용한 공간을 선호하는 지인들의 평가가 높아요." });
  }
  if (reasons.length === 0) {
    reasons.push({ code: "general_network", label: "네트워크에서 저장이 늘고 있는 곳이에요." });
  }
  return reasons;
}

export function revisitRate(reviews: Review[]): { rate: number | null; yesCount: number; sampleCount: number } {
  const sampleCount = reviews.length;
  if (sampleCount === 0) return { rate: null, yesCount: 0, sampleCount: 0 };
  const yesCount = reviews.filter((r) => r.revisitIntention === "definitely").length;
  return { rate: Math.round((yesCount / sampleCount) * 100) / 100, yesCount, sampleCount };
}
