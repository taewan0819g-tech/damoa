import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PlaceImage } from "@/components/place/PlaceImage";
import { AvatarStack } from "@/components/social/AvatarStack";
import { SaveButton } from "@/components/place/SaveButton";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS } from "@/lib/i18n/labels";
import { visitorSentence } from "@/lib/social/copy";
import type { MapPinData } from "@/types/domain";

export function PlaceBottomSheetContent({ pin, saved }: { pin: MapPinData; saved: boolean }) {
  const { place } = pin;
  const totalNetworkCount = pin.friendVisitCount + pin.secondDegreeVisitCount;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
          <PlaceImage src={place.imageUrl} alt={place.name} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{place.name}</h3>
          <p className="text-sm text-foreground-muted">
            {place.neighborhood} · {CATEGORY_LABELS[place.category]}
          </p>
          {pin.recentVisitorAvatars.length > 0 ? (
            <div className="mt-1.5 flex items-center gap-2">
              <AvatarStack authors={pin.recentVisitorAvatars} size={20} />
              <span className="text-xs text-foreground-muted">{visitorSentence(pin.recentVisitorAvatars, totalNetworkCount)}</span>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-foreground-muted">아직 친구의 방문 기록이 없어요.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button asChild className="flex-1">
          <Link href={`/place/${place.id}`}>
            자세히 보기
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <SaveButton placeId={place.id} initialSaved={saved} />
      </div>
    </div>
  );
}
