"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PlaceImage } from "@/components/place/PlaceImage";
import { searchPlaces } from "@/app/actions/places";
import { CATEGORY_LABELS } from "@/lib/i18n/labels";
import type { Place } from "@/types/domain";

export function PlaceSearchPicker({ suggestions }: { suggestions: Place[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!query.trim()) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchPlaces(query));
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const isSearching = query.trim().length > 0;
  const list = isSearching ? (results ?? []) : suggestions;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="장소, 동네, 카테고리로 검색"
          className="pl-10"
        />
      </div>

      {isSearching && !isPending && list.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground-muted">검색 결과가 없어요.</p>
      ) : (
        <div className="space-y-1">
          {!isSearching ? <p className="text-xs font-medium text-foreground-muted">추천 장소</p> : null}
          {list.map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => router.push(`/review/${place.id}`)}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-muted"
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                <PlaceImage src={place.imageUrl} alt={place.name} sizes="48px" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{place.name}</p>
                <p className="truncate text-xs text-foreground-muted">
                  {place.neighborhood} · {CATEGORY_LABELS[place.category]}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
