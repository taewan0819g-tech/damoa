import { getSessionUserId } from "@/lib/auth/session";
import { getPlaceRepository } from "@/lib/repositories/factory";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";
import { SearchExperience } from "@/components/search/SearchExperience";

export default async function SearchPage() {
  const userId = (await getSessionUserId())!;
  const places = await getPlaceRepository().list();
  const withSummary = await Promise.all(places.map(async (place) => ({ place, summary: await getPlaceSocialSummary(place.id, userId) })));
  const trending = withSummary.sort((a, b) => b.summary.recommendationScore - a.summary.recommendationScore).slice(0, 12);

  return <SearchExperience trending={trending} />;
}
