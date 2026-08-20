import Link from "next/link";
import { MapPin } from "lucide-react";
import { PlaceImage } from "@/components/place/PlaceImage";
import { SaveButton } from "@/components/place/SaveButton";
import { AvatarStack } from "@/components/social/AvatarStack";
import { NetworkRating } from "@/components/place/NetworkRating";
import { CATEGORY_LABELS } from "@/lib/i18n/labels";
import type { Place, PlaceSocialSummary, SafeReview } from "@/types/domain";

/**
 * The feed's primary unit: a social event involving a place, not just a
 * restaurant listing (spec #9/#101). `headline` carries the social context
 * ("Jin 외 2명이 최근 방문") — always render it above the photo.
 */
export function PlaceCard({
  place,
  summary,
  headline,
  subline,
  highlightReview,
  saved,
}: {
  place: Place;
  summary: PlaceSocialSummary;
  headline: string;
  subline?: string | null;
  highlightReview?: SafeReview | null;
  saved: boolean;
}) {
  return (
    <article className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-start gap-2 px-4 pt-4">
        <AvatarStack authors={summary.recentVisitors} size={22} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{headline}</p>
          {subline ? <p className="text-xs text-foreground-muted">{subline}</p> : null}
        </div>
      </div>

      <Link href={`/place/${place.id}`} className="mt-3 block">
        <div className="relative aspect-[4/3] w-full bg-surface-muted">
          <PlaceImage src={place.imageUrl} alt={place.name} />
        </div>
      </Link>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/place/${place.id}`} className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{place.name}</h3>
            <p className="text-sm text-foreground-muted">
              {place.neighborhood} · {CATEGORY_LABELS[place.category]}
            </p>
          </Link>
          <NetworkRating rating={summary.trustedRating} count={summary.trustedRatingCount} />
        </div>

        {highlightReview?.text ? (
          <blockquote className="rounded-xl bg-surface-muted px-3 py-2.5 text-sm text-foreground">
            <p className="leading-relaxed">&ldquo;{highlightReview.text}&rdquo;</p>
            <p className="mt-1 text-xs text-foreground-muted">
              {highlightReview.isAnonymous ? highlightReview.displayIdentity : highlightReview.author?.displayName} ·{" "}
              {highlightReview.isAnonymous ? highlightReview.approximateTime : "최근"}
            </p>
          </blockquote>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Link
            href={`/map?place=${place.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-foreground-muted hover:border-accent/40"
          >
            <MapPin className="h-3.5 w-3.5" />
            지도에서 보기
          </Link>
          <SaveButton placeId={place.id} initialSaved={saved} />
        </div>
      </div>
    </article>
  );
}
