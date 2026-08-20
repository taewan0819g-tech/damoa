import type { Collection, SavedPlace, UUID } from "@/types/domain";
import type { SavedPlaceRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

export class DemoSavedPlaceRepository implements SavedPlaceRepository {
  async getByUser(userId: UUID): Promise<SavedPlace[]> {
    return demoStore.savedPlaces.filter((s) => s.userId === userId);
  }

  async getCollections(userId: UUID): Promise<Collection[]> {
    return demoStore.collections.filter((c) => c.userId === userId);
  }

  async save(userId: UUID, placeId: UUID, collectionId: UUID | null): Promise<SavedPlace> {
    const existing = demoStore.savedPlaces.find((s) => s.userId === userId && s.placeId === placeId);
    if (existing) return existing;
    const saved: SavedPlace = {
      id: demoStore.nextId("sp"),
      userId,
      placeId,
      collectionId,
      createdAt: new Date().toISOString(),
    };
    demoStore.savedPlaces.unshift(saved);
    return saved;
  }

  async unsave(userId: UUID, placeId: UUID): Promise<void> {
    demoStore.savedPlaces = demoStore.savedPlaces.filter((s) => !(s.userId === userId && s.placeId === placeId));
  }

  async createCollection(userId: UUID, name: string): Promise<Collection> {
    const collection: Collection = { id: demoStore.nextId("col"), userId, name, createdAt: new Date().toISOString() };
    demoStore.collections.push(collection);
    return collection;
  }
}
