import type { Circle, PlaceSocialSummary, SafeAuthor, SocialDistance, UUID } from "@/types/domain";
import { getPlaceRepository, getReviewRepository, getSavedPlaceRepository, getSocialRepository, getVisitRepository } from "@/lib/repositories/factory";
import { computeRecommendationScore, generateReasons, networkQuality, revisitRate } from "@/lib/recommendations/recommendationService";
import { computeTasteProfile, tasteSimilarity } from "@/lib/recommendations/tasteProfile";
import { daysBetween } from "@/lib/ranking/decay";

/**
 * The only place in the app that walks the friend graph. Feed, map, and
 * place pages all call into this service instead of re-deriving social
 * relationships themselves (spec #67).
 */

function directFriendIds(relationships: { requesterId: UUID; addresseeId: UUID; status: string }[], userId: UUID): Set<UUID> {
  const ids = new Set<UUID>();
  for (const r of relationships) {
    if (r.status !== "accepted") continue;
    if (r.requesterId === userId) ids.add(r.addresseeId);
    if (r.addresseeId === userId) ids.add(r.requesterId);
  }
  return ids;
}

export async function getDirectFriends(userId: UUID): Promise<UUID[]> {
  const social = getSocialRepository();
  const relationships = await social.getRelationships(userId);
  return Array.from(directFriendIds(relationships, userId));
}

export async function getFriendsOfFriends(userId: UUID): Promise<UUID[]> {
  const social = getSocialRepository();
  const directs = await getDirectFriends(userId);
  const seen = new Set<UUID>([userId, ...directs]);
  const result = new Set<UUID>();
  for (const friendId of directs) {
    const theirRelationships = await social.getRelationships(friendId);
    for (const id of directFriendIds(theirRelationships, friendId)) {
      if (!seen.has(id)) result.add(id);
    }
  }
  return Array.from(result);
}

export async function getSharedCircles(userId: UUID, otherUserId: UUID): Promise<Circle[]> {
  const social = getSocialRepository();
  const [mine, theirs] = await Promise.all([social.getCircles(userId), social.getCircles(otherUserId)]);
  const theirIds = new Set(theirs.map((c) => c.id));
  return mine.filter((c) => theirIds.has(c.id));
}

export async function getSocialDistance(userId: UUID, otherUserId: UUID): Promise<SocialDistance> {
  if (userId === otherUserId) return "self";
  const social = getSocialRepository();
  if (await social.isBlocked(userId, otherUserId)) return "stranger";

  const directs = await getDirectFriends(userId);
  if (directs.includes(otherUserId)) return "direct_friend";

  const sharedCircles = await getSharedCircles(userId, otherUserId);
  const fof = await getFriendsOfFriends(userId);
  if (fof.includes(otherUserId)) return "friend_of_friend";
  if (sharedCircles.length > 0) return "shared_circle";

  return "network";
}

export interface NetworkVisitor {
  author: SafeAuthor;
  distance: SocialDistance;
}

/** Visitors of a place, restricted to what the viewer is allowed to see (spec #40/#105). */
export async function getNetworkVisitors(placeId: UUID, viewerId: UUID): Promise<NetworkVisitor[]> {
  const [visits, social, visitRepo] = [undefined, getSocialRepository(), getVisitRepository()];
  void visits;
  const allVisits = await visitRepo.getByPlace(placeId);
  const [directs, fof] = await Promise.all([getDirectFriends(viewerId), getFriendsOfFriends(viewerId)]);

  const uniqueVisitorIds = Array.from(new Set(allVisits.map((v) => v.userId))).filter((id) => id !== viewerId);
  const visitors: NetworkVisitor[] = [];

  for (const visitorId of uniqueVisitorIds) {
    const visit = allVisits.find((v) => v.userId === visitorId)!;
    if (visit.visibility === "private") continue;
    if (await social.isBlocked(viewerId, visitorId)) continue;

    let distance: SocialDistance = "network";
    if (directs.includes(visitorId)) distance = "direct_friend";
    else if (fof.includes(visitorId)) distance = "friend_of_friend";
    else {
      const shared = await getSharedCircles(viewerId, visitorId);
      if (shared.length > 0) distance = "shared_circle";
    }

    // Friends-of-friends only see activity when the sharer opted in.
    if (distance === "friend_of_friend") {
      const settings = await import("@/lib/repositories/factory").then((m) => m.getPrivacyRepository().getSettings(visitorId));
      if (!settings.showToFriendsOfFriends) continue;
    }
    if (distance === "network" && visit.visibility !== "public") continue;

    const profile = await social.getProfile(visitorId);
    if (!profile) continue;

    visitors.push({
      author: { id: profile.id, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl },
      distance,
    });
  }

  return visitors.sort((a, b) => distanceRank(a.distance) - distanceRank(b.distance));
}

function distanceRank(d: SocialDistance) {
  const order: SocialDistance[] = ["self", "direct_friend", "shared_circle", "friend_of_friend", "network", "stranger"];
  return order.indexOf(d);
}

/**
 * The single source of truth for "what does this place look like to this
 * viewer" — consumed by feed, map, and place pages alike (spec #68).
 */
export async function getPlaceSocialSummary(placeId: UUID, viewerId: UUID): Promise<PlaceSocialSummary> {
  const [place, visits, reviews, visitors, savedByViewer, tasteProfile] = await Promise.all([
    getPlaceRepository().getById(placeId),
    getVisitRepository().getByPlace(placeId),
    getReviewRepository().getByPlace(placeId),
    getNetworkVisitors(placeId, viewerId),
    getSavedPlaceRepository().getByUser(viewerId),
    computeTasteProfile(viewerId),
  ]);

  if (!place) {
    return {
      placeId,
      friendVisitCount: 0,
      secondDegreeVisitCount: 0,
      trustedRating: null,
      trustedRatingCount: 0,
      revisitRate: null,
      revisitYesCount: 0,
      revisitSampleCount: 0,
      recentVisitors: [],
      recommendationReasons: [],
      recentNetworkActivity: null,
      recommendationScore: 0,
    };
  }

  const visitorIds = new Set(visitors.map((v) => v.author.id));
  const networkReviews = reviews.filter((r) => visitorIds.has(r.userId) || r.userId === viewerId);
  const friendVisitors = visitors.filter((v) => v.distance === "direct_friend" || v.distance === "shared_circle");
  const secondDegreeVisitors = visitors.filter((v) => v.distance === "friend_of_friend");

  const { adjustedRating, sampleSize } = networkQuality(networkReviews.map((r) => r.rating));
  const { rate, yesCount, sampleCount } = revisitRate(networkReviews);

  const recentFriendVisits = visits.filter(
    (v) => friendVisitors.some((f) => f.author.id === v.userId) && daysBetween(v.visitedAt) <= 14
  );

  const hasViewerVisited = visits.some((v) => v.userId === viewerId);
  const hasViewerSaved = savedByViewer.some((s) => s.placeId === placeId);
  const similarity = tasteSimilarity(tasteProfile, place);

  const { score } = computeRecommendationScore({
    socialDistanceOfVisitors: visitors.map((v) => v.distance),
    visitDates: visits.map((v) => v.visitedAt),
    tasteSimilarity: similarity,
    ratings: networkReviews.map((r) => r.rating),
    hasViewerVisited,
    hasViewerSaved,
  });

  const isQuietPlace = place.category === "cafe" || place.category === "culture" || place.category === "bakery";
  const reasons = generateReasons({
    friendVisitCount: friendVisitors.length,
    recentFriendVisitCount: recentFriendVisits.length,
    tasteSimilarity: similarity,
    circleTrend: secondDegreeVisitors.length >= 2,
    quietTasteMatch: isQuietPlace && (tasteProfile.moods.quiet ?? 0) > 0.5,
  });

  const recentNetworkActivity =
    recentFriendVisits.length >= 2
      ? `친구 ${recentFriendVisits.length}명이 최근 14일 동안 방문했어요.`
      : friendVisitors.length > 0
        ? null
        : secondDegreeVisitors.length >= 2
          ? "친구의 친구들 사이에서 자주 언급되는 곳이에요."
          : null;

  return {
    placeId,
    friendVisitCount: friendVisitors.length,
    secondDegreeVisitCount: secondDegreeVisitors.length,
    trustedRating: adjustedRating,
    trustedRatingCount: sampleSize,
    revisitRate: rate,
    revisitYesCount: yesCount,
    revisitSampleCount: sampleCount,
    recentVisitors: visitors.slice(0, 5).map((v) => v.author),
    recommendationReasons: reasons,
    recentNetworkActivity,
    recommendationScore: score,
  };
}
