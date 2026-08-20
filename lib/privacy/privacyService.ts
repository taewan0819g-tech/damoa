import { K_ANONYMITY_THRESHOLD } from "@/config/constants";
import type { Review, SafeReview, UUID, Visit } from "@/types/domain";
import { getPrivacyRepository, getReviewRepository, getSocialRepository, getVisitRepository } from "@/lib/repositories/factory";
import { getSharedCircles, getSocialDistance } from "@/lib/social/socialGraphService";

/**
 * Every rule about "who can see what" lives here. This is the module that
 * makes anonymous reviews actually anonymous (spec #16/#17/#40/#104): the
 * client is only ever handed the output of toSafeReview(), never a raw
 * Review row with a user_id attached to anonymous content.
 */

export async function canViewVisit(viewerId: UUID, visit: Visit): Promise<boolean> {
  if (visit.userId === viewerId) return true;
  const social = getSocialRepository();
  if (await social.isBlocked(viewerId, visit.userId)) return false;

  if (visit.visibility === "private") return false;
  if (visit.visibility === "public" || visit.visibility === "network_anonymous") return true;

  // "friends" visibility: direct friends or a shared trusted circle.
  const distance = await getSocialDistance(viewerId, visit.userId);
  if (distance === "direct_friend" || distance === "shared_circle") return true;
  if (distance === "friend_of_friend") {
    const settings = await getPrivacyRepository().getSettings(visit.userId);
    return settings.showToFriendsOfFriends;
  }
  return false;
}

export async function canViewReview(viewerId: UUID, review: Review): Promise<boolean> {
  if (review.userId === viewerId) return true;
  const social = getSocialRepository();
  if (await social.isBlocked(viewerId, review.userId)) return false;

  switch (review.visibility) {
    case "private":
      return false;
    case "public":
      return true;
    case "network_anonymous": {
      // Anonymous content still requires *some* trust relationship to reach
      // the viewer — a total stranger with zero graph connection doesn't see it.
      const distance = await getSocialDistance(viewerId, review.userId);
      return distance !== "stranger";
    }
    case "friends": {
      const distance = await getSocialDistance(viewerId, review.userId);
      return distance === "direct_friend" || distance === "shared_circle";
    }
    default:
      return false;
  }
}

/**
 * Anonymity-set size: how many people the viewer knows could plausibly have
 * authored an anonymous review of this place (spec #17). Computed from
 * everyone who visited the place with non-private visibility — the true
 * author is drawn from that pool, so a viewer can never narrow it down
 * below this count.
 */
export async function getAnonymitySetSize(placeId: UUID): Promise<number> {
  const visits = await getVisitRepository().getByPlace(placeId);
  const visibleVisitorIds = new Set(visits.filter((v) => v.visibility !== "private").map((v) => v.userId));
  return visibleVisitorIds.size;
}

export function getAnonymousTimeBucket(createdAt: string): string {
  const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 3) return "최근";
  if (days <= 7) return "이번 주";
  if (days <= 30) return "이번 달";
  return "이전 방문";
}

const GENERIC_NETWORK_LABEL = "LocalGraph 사용자";
const FRIEND_NETWORK_LABEL = "친구 네트워크 사용자";
const FRIEND_OF_FRIEND_LABEL = "친구의 친구";

export async function getSafeReviewIdentity(
  viewerId: UUID,
  review: Review
): Promise<{ displayIdentity: string; author: SafeReview["author"] }> {
  if (review.visibility === "public" || review.visibility === "friends") {
    const profile = await getSocialRepository().getProfile(review.userId);
    if (!profile) return { displayIdentity: GENERIC_NETWORK_LABEL, author: null };
    return {
      displayIdentity: profile.displayName,
      author: { id: profile.id, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl },
    };
  }

  // network_anonymous (and any other non-attributed case): never leak identity.
  const anonymitySetSize = await getAnonymitySetSize(review.placeId);
  if (anonymitySetSize < K_ANONYMITY_THRESHOLD) {
    return { displayIdentity: GENERIC_NETWORK_LABEL, author: null };
  }

  const distance = await getSocialDistance(viewerId, review.userId);
  if (distance === "direct_friend" || distance === "shared_circle") {
    return { displayIdentity: FRIEND_NETWORK_LABEL, author: null };
  }
  if (distance === "friend_of_friend") {
    return { displayIdentity: FRIEND_OF_FRIEND_LABEL, author: null };
  }
  return { displayIdentity: GENERIC_NETWORK_LABEL, author: null };
}

/**
 * The one function UI code should call to turn a Review into something safe
 * to send to the browser. `canModerate` communicates that report/hide
 * controls should render — it never carries the author id to the client.
 */
export async function toSafeReview(viewerId: UUID, review: Review): Promise<SafeReview> {
  const isAnonymous = review.visibility === "network_anonymous";
  const { displayIdentity, author } = await getSafeReviewIdentity(viewerId, review);
  const reviewRepo = getReviewRepository();
  const [helpfulCount, viewerFoundHelpful] = await Promise.all([
    reviewRepo.getHelpfulCount(review.id),
    reviewRepo.hasReacted(review.id, viewerId),
  ]);

  return {
    id: review.id,
    placeId: review.placeId,
    rating: review.rating,
    text: review.reviewText,
    revisitIntention: review.revisitIntention,
    tags: review.tags,
    visibility: review.visibility,
    displayIdentity,
    author,
    approximateTime: isAnonymous ? getAnonymousTimeBucket(review.createdAt) : review.createdAt,
    isAnonymous,
    helpfulCount,
    viewerFoundHelpful,
    canModerate: review.userId !== viewerId,
  };
}

/** Fetches + filters + redacts in one call — the primary entry point for review lists. */
export async function getSafeReviewsForPlace(viewerId: UUID, placeId: UUID): Promise<SafeReview[]> {
  const reviews = await getReviewRepository().getByPlace(placeId);
  const visible: Review[] = [];
  for (const review of reviews) {
    if (await canViewReview(viewerId, review)) visible.push(review);
  }
  const safe = await Promise.all(visible.map((r) => toSafeReview(viewerId, r)));
  return safe.sort((a, b) => (a.isAnonymous || b.isAnonymous ? 0 : new Date(b.approximateTime).getTime() - new Date(a.approximateTime).getTime()));
}

export async function getSharedCircleNames(viewerId: UUID, otherUserId: UUID): Promise<string[]> {
  const circles = await getSharedCircles(viewerId, otherUserId);
  return circles.map((c) => c.name);
}
