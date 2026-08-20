import type { MapPinData, PlaceCategory, UUID } from "@/types/domain";
import { getPlaceRepository, getSavedPlaceRepository, getVisitRepository } from "@/lib/repositories/factory";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";

export type MapFilter = "all" | "friends" | "fof" | "saved" | "visited" | PlaceCategory;

function signalStrength(friendVisitCount: number, secondDegreeVisitCount: number): MapPinData["signalStrength"] {
  if (friendVisitCount >= 2) return "strong";
  if (friendVisitCount === 1 || secondDegreeVisitCount >= 2) return "medium";
  return "weak";
}

/** Builds every pin the map needs, pre-filtered by the viewer's chosen lens
 * (spec #12/#48) — map and feed both read PlaceSocialSummary so ratings and
 * visit counts never disagree between screens. */
export async function getMapPins(viewerId: UUID, filter: MapFilter = "all"): Promise<MapPinData[]> {
  const [places, saved, myVisits] = await Promise.all([
    getPlaceRepository().list(),
    getSavedPlaceRepository().getByUser(viewerId),
    getVisitRepository().getByUser(viewerId),
  ]);
  const savedPlaceIds = new Set(saved.map((s) => s.placeId));
  const visitedPlaceIds = new Set(myVisits.map((v) => v.placeId));

  const pins: MapPinData[] = [];
  for (const place of places) {
    if (filter === "saved" && !savedPlaceIds.has(place.id)) continue;
    if (filter === "visited" && !visitedPlaceIds.has(place.id)) continue;
    if (filter !== "all" && filter !== "saved" && filter !== "visited" && filter !== "friends" && filter !== "fof" && place.category !== filter) {
      continue;
    }

    const summary = await getPlaceSocialSummary(place.id, viewerId);
    if (filter === "friends" && summary.friendVisitCount === 0) continue;
    if (filter === "fof" && summary.secondDegreeVisitCount === 0) continue;

    pins.push({
      place,
      friendVisitCount: summary.friendVisitCount,
      secondDegreeVisitCount: summary.secondDegreeVisitCount,
      signalStrength: signalStrength(summary.friendVisitCount, summary.secondDegreeVisitCount),
      recentVisitorAvatars: summary.recentVisitors.slice(0, 3),
    });
  }
  return pins;
}
