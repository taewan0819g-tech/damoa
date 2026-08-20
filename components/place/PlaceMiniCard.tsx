import Link from "next/link";
import { PlaceImage } from "@/components/place/PlaceImage";
import { NetworkRating } from "@/components/place/NetworkRating";
import { CATEGORY_LABELS } from "@/lib/i18n/labels";
import type { Place, PlaceSocialSummary } from "@/types/domain";

/** Compact card for saved/search grids. Fills its container's width — wrap
 * with a fixed-width div for horizontally scrolling rails. */
export function PlaceMiniCard({ place, summary }: { place: Place; summary: PlaceSocialSummary }) {
  return (
    <Link href={`/place/${place.id}`} className="block w-full">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-surface-muted">
        <PlaceImage src={place.imageUrl} alt={place.name} />
      </div>
      <div className="mt-2 space-y-0.5">
        <h4 className="truncate text-sm font-semibold text-foreground">{place.name}</h4>
        <p className="truncate text-xs text-foreground-muted">
          {place.neighborhood} · {CATEGORY_LABELS[place.category]}
        </p>
        <NetworkRating rating={summary.trustedRating} count={summary.trustedRatingCount} compact />
      </div>
    </Link>
  );
}
