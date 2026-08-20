import type { Place, PlaceCategory, Review, TasteProfile, UUID } from "@/types/domain";
import { getPlaceRepository, getReviewRepository, getSavedPlaceRepository } from "@/lib/repositories/factory";

const MOOD_TAGS_BY_CATEGORY: Partial<Record<PlaceCategory, string[]>> = {
  cafe: ["quiet", "value"],
  bakery: ["quiet", "value"],
  korean: ["value"],
  bar: ["nightlife"],
  culture: ["quiet"],
  outdoors: ["value"],
};

/**
 * MVP heuristic taste profile (spec #28): weight categories & moods by how
 * positively the user reviewed them, how often they saved them, and whether
 * they said they'd return. No ML/embeddings needed for the MVP — the
 * function signature is the seam where a real model could plug in later.
 */
export async function computeTasteProfile(userId: UUID): Promise<TasteProfile> {
  const reviewRepo = getReviewRepository();
  const savedRepo = getSavedPlaceRepository();
  const placeRepo = getPlaceRepository();

  const [reviews, saved] = await Promise.all([reviewRepo.getByUser(userId), savedRepo.getByUser(userId)]);

  const placeIds = Array.from(new Set([...reviews.map((r) => r.placeId), ...saved.map((s) => s.placeId)]));
  const places = await Promise.all(placeIds.map((id) => placeRepo.getById(id)));
  const placeById = new Map(places.filter((p): p is Place => Boolean(p)).map((p) => [p.id, p]));

  const categories: Partial<Record<PlaceCategory, number>> = {};
  const moods: Record<string, number> = { quiet: 0, value: 0, nightlife: 0 };
  const categoryCounts: Partial<Record<PlaceCategory, number>> = {};

  function bumpCategory(category: PlaceCategory, weight: number) {
    categories[category] = (categories[category] ?? 0) + weight;
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }

  const reviewWeight = (r: Review) => {
    const ratingSignal = (r.rating - 2.5) / 2.5; // -1..1
    const revisitSignal = r.revisitIntention === "definitely" ? 0.4 : r.revisitIntention === "maybe" ? 0.1 : -0.2;
    return Math.max(0, ratingSignal + revisitSignal);
  };

  for (const review of reviews) {
    const place = placeById.get(review.placeId);
    if (!place) continue;
    bumpCategory(place.category, reviewWeight(review));
    const moodTags = MOOD_TAGS_BY_CATEGORY[place.category] ?? [];
    for (const mood of moodTags) moods[mood] = (moods[mood] ?? 0) + reviewWeight(review) * 0.5;
    if (review.tags.includes("quiet_talk")) moods.quiet += 0.3;
  }

  for (const s of saved) {
    const place = placeById.get(s.placeId);
    if (!place) continue;
    bumpCategory(place.category, 0.3);
  }

  // Normalize to 0-1 per category.
  const maxCategoryScore = Math.max(1, ...Object.values(categories));
  for (const key of Object.keys(categories) as PlaceCategory[]) {
    categories[key] = Math.min(1, Math.round(((categories[key] ?? 0) / maxCategoryScore) * 100) / 100);
  }
  const maxMoodScore = Math.max(1, ...Object.values(moods));
  for (const key of Object.keys(moods)) {
    moods[key] = Math.min(1, Math.round((moods[key] / maxMoodScore) * 100) / 100);
  }

  return { categories, moods };
}

/** Cosine-similarity-flavored comparison between a user's taste and a place's category/mood signal. */
export function tasteSimilarity(profile: TasteProfile, place: Place): number {
  const categoryScore = profile.categories[place.category] ?? 0;
  const moodTags = MOOD_TAGS_BY_CATEGORY[place.category] ?? [];
  const moodScore = moodTags.length > 0 ? moodTags.reduce((sum, m) => sum + (profile.moods[m] ?? 0), 0) / moodTags.length : 0;
  return Math.min(1, categoryScore * 0.7 + moodScore * 0.3);
}
