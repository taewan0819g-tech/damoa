"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth/session";
import { getPlaceRepository, getSavedPlaceRepository } from "@/lib/repositories/factory";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";
import { track } from "@/lib/analytics/analytics";
import type { Place, PlaceSocialSummary } from "@/types/domain";

export async function searchPlaces(query: string): Promise<Place[]> {
  if (!query.trim()) return [];
  return getPlaceRepository().search(query);
}

export async function searchPlacesWithSummary(query: string): Promise<{ place: Place; summary: PlaceSocialSummary }[]> {
  if (!query.trim()) return [];
  const userId = await getSessionUserId();
  if (!userId) return [];
  const places = await getPlaceRepository().search(query);
  return Promise.all(places.map(async (place) => ({ place, summary: await getPlaceSocialSummary(place.id, userId) })));
}

export async function toggleSavePlace(placeId: string, collectionId: string | null = null): Promise<{ saved: boolean }> {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  const repo = getSavedPlaceRepository();
  const existing = await repo.getByUser(userId);
  const already = existing.some((s) => s.placeId === placeId);

  if (already) {
    await repo.unsave(userId, placeId);
  } else {
    await repo.save(userId, placeId, collectionId);
    track("place_saved", { placeId });
  }

  revalidatePath("/saved");
  revalidatePath("/home");
  revalidatePath(`/place/${placeId}`);
  return { saved: !already };
}

export async function createCollection(name: string) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("로그인이 필요해요.");
  const repo = getSavedPlaceRepository();
  const collection = await repo.createCollection(userId, name);
  revalidatePath("/saved");
  return collection;
}
