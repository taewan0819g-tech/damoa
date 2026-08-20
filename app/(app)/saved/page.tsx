import Link from "next/link";
import { Bookmark } from "lucide-react";
import { PlaceMiniCard } from "@/components/place/PlaceMiniCard";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getPlaceRepository, getSavedPlaceRepository } from "@/lib/repositories/factory";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";
import { cn } from "@/lib/utils/cn";

export default async function SavedPage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
  const { collection: collectionParam } = await searchParams;
  const userId = (await getSessionUserId())!;

  const [saved, collections] = await Promise.all([
    getSavedPlaceRepository().getByUser(userId),
    getSavedPlaceRepository().getCollections(userId),
  ]);

  const filtered = collectionParam ? saved.filter((s) => s.collectionId === collectionParam) : saved;
  const placeRepo = getPlaceRepository();
  const entries = await Promise.all(
    filtered.map(async (s) => {
      const place = await placeRepo.getById(s.placeId);
      if (!place) return null;
      const summary = await getPlaceSocialSummary(s.placeId, userId);
      return { place, summary };
    })
  );
  const items = entries.filter((e): e is { place: NonNullable<typeof e>["place"]; summary: NonNullable<typeof e>["summary"] } => e !== null);

  return (
    <div className="space-y-4 px-4 py-4">
      <h1 className="text-lg font-bold text-foreground">저장한 장소</h1>

      {collections.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          <Link
            href="/saved"
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              !collectionParam ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-foreground-muted hover:border-accent/40"
            )}
          >
            전체
          </Link>
          {collections.map((c) => (
            <Link
              key={c.id}
              href={`/saved?collection=${c.id}`}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                collectionParam === c.id ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-foreground-muted hover:border-accent/40"
              )}
            >
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="h-6 w-6" />}
          title="아직 저장한 장소가 없어요"
          description="마음에 드는 장소를 저장하면 여기서 모아볼 수 있어요."
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
          {items.map(({ place, summary }) => (
            <PlaceMiniCard key={place.id} place={place} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}
