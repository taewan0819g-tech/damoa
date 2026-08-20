"use client";

import { useEffect, useState, useTransition } from "react";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PlaceMiniCard } from "@/components/place/PlaceMiniCard";
import { EmptyState } from "@/components/ui/empty-state";
import { searchPlacesWithSummary } from "@/app/actions/places";
import type { Place, PlaceSocialSummary } from "@/types/domain";

export function SearchExperience({ trending }: { trending: { place: Place; summary: PlaceSocialSummary }[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ place: Place; summary: PlaceSocialSummary }[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!query.trim()) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchPlacesWithSummary(query));
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const isSearching = query.trim().length > 0;
  const items = isSearching ? (results ?? []) : trending;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="장소, 동네, 카테고리로 검색" className="pl-10" />
      </div>

      <p className="text-xs font-medium text-foreground-muted">{!isSearching ? "친구 네트워크에서 인기 있는 곳" : `검색 결과 ${items.length}개`}</p>

      {!isPending && isSearching && items.length === 0 ? (
        <EmptyState icon={<SearchIcon className="h-6 w-6" />} title="검색 결과가 없어요" description="다른 검색어로 시도해 보세요." />
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
