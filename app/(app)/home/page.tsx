import Link from "next/link";
import { Users } from "lucide-react";
import { PlaceCard } from "@/components/place/PlaceCard";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getSavedPlaceRepository } from "@/lib/repositories/factory";
import { getHomeFeed, type FeedScope } from "@/lib/feed/feedService";
import { cn } from "@/lib/utils/cn";

const SCOPES: { value: FeedScope; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "friends", label: "친구" },
  { value: "fof", label: "친구의 친구" },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope: scopeParam } = await searchParams;
  const scope: FeedScope = SCOPES.some((s) => s.value === scopeParam) ? (scopeParam as FeedScope) : "all";

  const userId = (await getSessionUserId())!;
  const [feed, saved] = await Promise.all([getHomeFeed(userId, scope), getSavedPlaceRepository().getByUser(userId)]);
  const savedPlaceIds = new Set(saved.map((s) => s.placeId));

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {SCOPES.map((s) => (
          <Link
            key={s.value}
            href={s.value === "all" ? "/home" : `/home?scope=${s.value}`}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              scope === s.value
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface text-foreground-muted hover:border-accent/40"
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {feed.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="아직 보여드릴 친구 활동이 없어요"
          description="친구를 추가하면 그들이 다녀온 곳과 후기가 여기에 모여요."
          action={
            <Link href="/onboarding" className="text-sm font-medium text-accent hover:underline">
              친구 찾아보기
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {feed.map((item) => (
            <PlaceCard
              key={item.id}
              place={item.place}
              summary={item.socialSummary}
              headline={item.headline}
              subline={item.subline}
              highlightReview={item.highlightReview}
              saved={savedPlaceIds.has(item.place.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
