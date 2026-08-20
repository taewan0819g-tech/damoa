import type { Place, Review, SavedPlace, UserProfile, Visit } from "@/types/domain";

/* eslint-disable @typescript-eslint/no-explicit-any */
// These mappers translate snake_case Postgres rows (see supabase/migrations)
// into the camelCase domain types the rest of the app consumes.

export function mapPlaceRow(row: any): Place {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    address: row.address,
    neighborhood: row.neighborhood,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    priceLevel: row.price_level,
    imageUrl: row.image_url,
    images: row.images ?? (row.image_url ? [row.image_url] : []),
    isOpenNow: row.is_open_now ?? null,
  };
}

export function mapProfileRow(row: any): UserProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    homeArea: row.home_area,
    createdAt: row.created_at,
  };
}

export function mapVisitRow(row: any): Visit {
  return {
    id: row.id,
    userId: row.user_id,
    placeId: row.place_id,
    visitedAt: row.visited_at,
    visibility: row.visibility,
    photoUrl: row.photo_url,
    companionIds: row.companion_ids ?? [],
  };
}

export function mapReviewRow(row: any): Review {
  return {
    id: row.id,
    userId: row.user_id,
    placeId: row.place_id,
    visitId: row.visit_id,
    rating: Number(row.rating),
    reviewText: row.review_text,
    revisitIntention: row.revisit_intention,
    priceRating: row.price_rating,
    noiseRating: row.noise_rating,
    waitRating: row.wait_rating,
    tags: (row.review_tags ?? []).map((t: any) => t.tag ?? t),
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSavedPlaceRow(row: any): SavedPlace {
  return {
    id: row.id,
    userId: row.user_id,
    placeId: row.place_id,
    collectionId: row.collection_id,
    createdAt: row.created_at,
  };
}
