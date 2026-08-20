import { notFound } from "next/navigation";
import { MapPin, MessageSquare } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { AddFriendButton } from "@/components/social/AddFriendButton";
import { ReviewCard } from "@/components/review/ReviewCard";
import { getSessionUserId, getCurrentUser } from "@/lib/auth/session";
import { getReviewRepository, getSocialRepository, getVisitRepository } from "@/lib/repositories/factory";
import { getSocialDistance } from "@/lib/social/socialGraphService";
import { canViewReview, toSafeReview } from "@/lib/privacy/privacyService";
import { signOutAction } from "@/app/actions/auth";
import type { Review } from "@/types/domain";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const viewerId = (await getSessionUserId())!;

  const social = getSocialRepository();
  const profile = username === "me" ? await getCurrentUser() : await social.getProfileByUsername(username);
  if (!profile) notFound();

  const isOwnProfile = profile.id === viewerId;
  const [relationships, circles, visits, allReviews] = await Promise.all([
    social.getRelationships(profile.id),
    social.getCircles(profile.id),
    getVisitRepository().getByUser(profile.id),
    getReviewRepository().getByUser(profile.id),
  ]);

  const friendCount = relationships.filter((r) => r.status === "accepted").length;
  const distance = isOwnProfile ? "self" : await getSocialDistance(viewerId, profile.id);
  const relationshipWithViewer = relationships.find((r) => r.requesterId === viewerId || r.addresseeId === viewerId);
  const friendStatus: "none" | "pending" | "friends" =
    distance === "direct_friend" ? "friends" : relationshipWithViewer?.status === "pending" ? "pending" : "none";

  // Anonymous reviews must never be attributable to a specific profile for
  // anyone but the author — showing them here for other viewers would
  // deanonymize the author, defeating the whole point of network_anonymous
  // visibility (spec #17). Only the owner sees their own anonymous reviews.
  const visibleReviews: Review[] = [];
  for (const review of allReviews) {
    if (review.visibility === "network_anonymous" && !isOwnProfile) continue;
    if (!isOwnProfile && !(await canViewReview(viewerId, review))) continue;
    visibleReviews.push(review);
  }
  const safeReviews = await Promise.all(visibleReviews.map((r) => toSafeReview(viewerId, r)));
  const visibleVisitCount = isOwnProfile ? visits.length : visits.filter((v) => v.visibility !== "private" && v.visibility !== "network_anonymous").length;

  return (
    <div className="px-4 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar src={profile.avatarUrl} alt={profile.displayName} size={64} />
          <div>
            <h1 className="text-lg font-bold text-foreground">{profile.displayName}</h1>
            <p className="text-sm text-foreground-muted">@{profile.username}</p>
            {profile.homeArea ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-foreground-muted">
                <MapPin className="h-3 w-3" />
                {profile.homeArea}
              </p>
            ) : null}
          </div>
        </div>
        {isOwnProfile ? (
          <form action={signOutAction}>
            <button type="submit" className="text-xs font-medium text-foreground-muted hover:text-foreground">
              로그아웃
            </button>
          </form>
        ) : (
          <AddFriendButton targetUserId={profile.id} initialStatus={friendStatus} />
        )}
      </div>

      {profile.bio ? <p className="mt-3 text-sm leading-relaxed text-foreground">{profile.bio}</p> : null}

      <div className="mt-4 flex items-center gap-4 border-y border-border py-3 text-sm">
        <span>
          <span className="font-semibold text-foreground">{visibleVisitCount}</span>{" "}
          <span className="text-foreground-muted">방문</span>
        </span>
        <span>
          <span className="font-semibold text-foreground">{safeReviews.length}</span>{" "}
          <span className="text-foreground-muted">후기</span>
        </span>
        <span>
          <span className="font-semibold text-foreground">{friendCount}</span>{" "}
          <span className="text-foreground-muted">친구</span>
        </span>
        <span>
          <span className="font-semibold text-foreground">{circles.length}</span>{" "}
          <span className="text-foreground-muted">모임</span>
        </span>
      </div>

      <div className="mt-5">
        <h2 className="mb-1 text-sm font-semibold text-foreground">남긴 후기</h2>
        {safeReviews.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="아직 남긴 후기가 없어요" />
        ) : (
          <div>
            {safeReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
