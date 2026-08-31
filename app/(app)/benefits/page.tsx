"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useMatchedBenefits } from "@/hooks/useMatchedBenefits";
import { useProfileStore } from "@/stores/profileStore";
import { searchBenefits } from "@/domain/benefit/search";
import { sortBenefits, type BenefitSort } from "@/domain/benefit/sort";
import { getSourceGroup, type BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import { BenefitCard } from "@/components/benefit/BenefitCard";
import { BenefitCardSkeleton } from "@/components/benefit/BenefitCardSkeleton";
import { Chip } from "@/components/ui/chip";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { CATEGORY_LABELS, SOURCE_GROUP_LABELS } from "@/lib/labels";
import type { BenefitCategory } from "@/types/benefit";

const GROUP_FILTERS: { value: BenefitSourceGroup | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "government", label: SOURCE_GROUP_LABELS.government },
  { value: "youth", label: SOURCE_GROUP_LABELS.youth },
  { value: "financial", label: SOURCE_GROUP_LABELS.financial },
];

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as BenefitCategory[];

const SORT_OPTIONS: { value: BenefitSort; label: string }[] = [
  { value: "recommended", label: "추천순" },
  { value: "deadline", label: "마감임박순" },
  { value: "latest", label: "최신순" },
  { value: "rate", label: "금리순" },
];

export default function BenefitsPage() {
  const { benefits, statusById, loading, error } = useMatchedBenefits();
  const profile = useProfileStore((s) => s.profile);

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<BenefitSourceGroup | "all">("all");
  const [category, setCategory] = useState<BenefitCategory | "all">("all");
  const [sort, setSort] = useState<BenefitSort>("recommended");

  const filtered = useMemo(() => {
    let result = searchBenefits(benefits, query);
    if (group !== "all") result = result.filter((b) => getSourceGroup(b) === group);
    if (category !== "all") result = result.filter((b) => b.category === category);
    return sortBenefits(result, statusById, profile, sort);
  }, [benefits, statusById, profile, query, group, category, sort]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-foreground">혜택 모아보기</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">정부·청년·금융 혜택을 한곳에서 검색하고 비교해 보세요.</p>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-foreground-muted"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="혜택, 기관명으로 검색"
          aria-label="혜택 검색"
          className="pl-11"
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none">
        {GROUP_FILTERS.map((f) => (
          <Chip key={f.value} selected={group === f.value} onClick={() => setGroup(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none">
        <Chip selected={category === "all"} onClick={() => setCategory("all")}>
          전체 카테고리
        </Chip>
        {ALL_CATEGORIES.map((c) => (
          <Chip key={c} selected={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-muted">{loading ? "불러오는 중" : `${filtered.length}개의 혜택`}</p>
        <Select
          aria-label="정렬"
          value={sort}
          onChange={(e) => setSort(e.target.value as BenefitSort)}
          className="h-9 w-32 text-xs"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <BenefitCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="혜택 정보를 불러오지 못했어요." description="잠시 후 다시 시도해 주세요." />
      ) : filtered.length === 0 ? (
        <EmptyState title="조건에 맞는 혜택이 없어요." description="검색어나 필터를 변경해 보세요." />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((benefit) => (
            <BenefitCard key={benefit.id} benefit={benefit} status={statusById.get(benefit.id) ?? "unknown"} />
          ))}
        </div>
      )}
    </div>
  );
}
