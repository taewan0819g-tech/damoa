import { getSessionUserId } from "@/lib/auth/session";
import { getSavedPlaceRepository } from "@/lib/repositories/factory";
import { getMapPins, type MapFilter } from "@/lib/map/mapService";
import { MapView } from "@/components/map/MapView";
import { MapFilterBar } from "@/components/map/MapFilterBar";

export default async function MapPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter: filterParam } = await searchParams;
  const filter = (filterParam ?? "all") as MapFilter;
  const userId = (await getSessionUserId())!;

  const [pins, saved] = await Promise.all([getMapPins(userId, filter), getSavedPlaceRepository().getByUser(userId)]);

  return (
    <div className="relative">
      <MapFilterBar activeFilter={filter} />
      <MapView pins={pins} savedPlaceIds={saved.map((s) => s.placeId)} />
    </div>
  );
}
