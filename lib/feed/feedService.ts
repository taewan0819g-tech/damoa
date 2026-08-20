import type { FeedItem, UUID } from "@/types/domain";
import { getPlaceRepository } from "@/lib/repositories/factory";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";
import { getSafeReviewsForPlace } from "@/lib/privacy/privacyService";
import { feedHeadline } from "@/lib/social/copy";

export type FeedScope = "all" | "friends" | "fof";

/**
 * Home feed: one card per place (never duplicate cards for the same place —
 * spec #70), restricted to places with real network activity, ranked by the
 * recommendation score. Feed and Map read from the same summary function so
 * "trusted rating" never disagrees between screens.
 */
export async function getHomeFeed(viewerId: UUID, scope: FeedScope = "all"): Promise<FeedItem[]> {
  const places = await getPlaceRepository().list();

  const items: FeedItem[] = [];

  for (const place of places) {
    const summary = await getPlaceSocialSummary(place.id, viewerId);
    const hasFriendActivity = summary.friendVisitCount > 0;
    const hasSecondDegreeActivity = summary.secondDegreeVisitCount > 0;
    if (!hasFriendActivity && !hasSecondDegreeActivity) continue;

    if (scope === "friends" && !hasFriendActivity) continue;
    if (scope === "fof" && !hasSecondDegreeActivity) continue;

    const friendNames = summary.recentVisitors.slice(0, Math.max(summary.friendVisitCount, 1)).map((v) => v.displayName);
    const headline = hasFriendActivity
      ? feedHeadline(friendNames, summary.friendVisitCount)
      : `친구의 친구 ${summary.secondDegreeVisitCount}명이 다녀왔어요`;

    const reviews = await getSafeReviewsForPlace(viewerId, place.id);
    const highlightReview =
      reviews.find((r) => r.text && r.isAnonymous) ?? reviews.find((r) => r.text) ?? null;

    items.push({
      id: place.id,
      place,
      socialSummary: summary,
      headline,
      subline: summary.recentNetworkActivity,
      actorAvatars: summary.recentVisitors,
      highlightReview,
      createdAt: new Date().toISOString(),
    });
  }

  return items.sort((a, b) => b.socialSummary.recommendationScore - a.socialSummary.recommendationScore);
}
