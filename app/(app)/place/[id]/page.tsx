import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquarePlus, MessageSquare } from "lucide-react";
import { PlacePhotoCarousel } from "@/components/place/PlacePhotoCarousel";
import { NetworkRating } from "@/components/place/NetworkRating";
import { WhyRecommended } from "@/components/place/WhyRecommended";
import { VisitButton } from "@/components/place/VisitButton";
import { SaveButton } from "@/components/place/SaveButton";
import { FriendContext } from "@/components/social/FriendContext";
import { RevisitBadge } from "@/components/review/RevisitBadge";
import { ReviewBreakdownBars } from "@/components/review/ReviewBreakdownBars";
import { ReviewCard } from "@/components/review/ReviewCard";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { getSessionUserId } from "@/lib/auth/session";
import { getPlaceRepository, getSavedPlaceRepository, getVisitRepository } from "@/lib/repositories/factory";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";
import { getSafeReviewsForPlace } from "@/lib/privacy/privacyService";
import { computeReviewBreakdown } from "@/lib/reviews/breakdown";
import { CATEGORY_LABELS, priceLevelLabel } from "@/lib/i18n/labels";

export default async function PlaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = (await getSessionUserId())!;

  const place = await getPlaceRepository().getById(id);
  if (!place) notFound();

  const [summary, reviews, saved, myVisits] = await Promise.all([
    getPlaceSocialSummary(id, userId),
    getSafeReviewsForPlace(userId, id),
    getSavedPlaceRepository().getByUser(userId),
    getVisitRepository().getByUser(userId),
  ]);

  const isSaved = saved.some((s) => s.placeId === id);
  const hasVisited = myVisits.some((v) => v.placeId === id);
  const breakdown = computeReviewBreakdown(reviews);
  const totalNetworkCount = summary.friendVisitCount + summary.secondDegreeVisitCount;

  return (
    <div>
      <PlacePhotoCarousel images={place.images.length > 0 ? place.images : [place.imageUrl]} name={place.name} />

      <div className="space-y-5 px-4 py-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">{place.name}</h1>
              <p className="mt-1 text-sm text-foreground-muted">
                {place.neighborhood} · {CATEGORY_LABELS[place.category]} · {priceLevelLabel(place.priceLevel)}
              </p>
            </div>
            <SaveButton placeId={place.id} initialSaved={isSaved} />
          </div>
          <div className="mt-3">
            <NetworkRating rating={summary.trustedRating} count={summary.trustedRatingCount} size="lg" />
          </div>
        </div>

        <WhyRecommended reasons={summary.recommendationReasons} />

        <div className="space-y-2 rounded-2xl border border-border p-4">
          <FriendContext visitors={summary.recentVisitors} totalCount={totalNetworkCount} />
          <RevisitBadge rate={summary.revisitRate} yesCount={summary.revisitYesCount} sampleCount={summary.revisitSampleCount} />
        </div>

        <div className="flex items-center gap-2">
          <VisitButton placeId={place.id} alreadyVisited={hasVisited} />
          <Button asChild variant="primary">
            <Link href={`/review/${place.id}`}>
              <MessageSquarePlus className="h-4 w-4" />
              후기 남기기
            </Link>
          </Button>
        </div>

        {breakdown ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">이런 점이 좋았어요</h2>
            <ReviewBreakdownBars breakdown={breakdown} />
          </div>
        ) : null}

        <div>
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            네트워크 후기 {reviews.length > 0 ? `· ${reviews.length}` : ""}
          </h2>
          {reviews.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-6 w-6" />}
              title="아직 네트워크 후기가 없어요"
              description="첫 후기를 남기고 친구들에게 솔직한 의견을 공유해 보세요."
            />
          ) : (
            <div>
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
