"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { PlaceBottomSheetContent } from "@/components/map/PlaceBottomSheetContent";
import type { MapPinData } from "@/types/domain";

const SocialMap = dynamic(() => import("@/components/map/SocialMap").then((m) => m.SocialMap), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-foreground-muted">지도를 불러오는 중...</div>,
});

export function MapView({ pins, savedPlaceIds }: { pins: MapPinData[]; savedPlaceIds: string[] }) {
  const [selected, setSelected] = useState<MapPinData | null>(null);
  const savedSet = new Set(savedPlaceIds);

  return (
    <div className="h-[calc(100dvh-9.5rem)] w-full md:h-[calc(100dvh-3.5rem)]">
      <SocialMap pins={pins} onSelect={setSelected} />
      <BottomSheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} title={selected?.place.name ?? "장소 정보"}>
        {selected ? <PlaceBottomSheetContent pin={selected} saved={savedSet.has(selected.place.id)} /> : null}
      </BottomSheet>
    </div>
  );
}
