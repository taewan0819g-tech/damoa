import type { Place, UUID } from "@/types/domain";
import type { PlaceRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export class DemoPlaceRepository implements PlaceRepository {
  async getById(id: UUID): Promise<Place | null> {
    return demoStore.places.find((p) => p.id === id) ?? null;
  }

  async list(): Promise<Place[]> {
    return [...demoStore.places];
  }

  async search(query: string): Promise<Place[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return demoStore.places.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.neighborhood.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.subcategory ?? "").toLowerCase().includes(q)
    );
  }

  async getNearby(lat: number, lng: number, radiusKm: number): Promise<Place[]> {
    return demoStore.places.filter((p) => haversineKm(lat, lng, p.latitude, p.longitude) <= radiusKm);
  }
}
