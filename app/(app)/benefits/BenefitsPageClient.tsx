"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { usePaginatedBenefits } from "@/hooks/usePaginatedBenefits";
import { type BenefitSort } from "@/domain/benefit/sort";
import { type BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import { BenefitCard } from "@/components/benefit/BenefitCard";
import { BenefitCardSkeleton } from "@/components/benefit/BenefitCardSkeleton";
import { Chip } from "@/components/ui/chip";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CATEGORY_LABELS, SOURCE_GROUP_LABELS } from "@/lib/labels";
import { type BenefitListState, buildListSearchParams, buildListUrl, parseListState } from "@/lib/benefits/listState";
import type { BenefitCategory } from "@/types/benefit";

const PAGE_SIZE = 20;

// Non-IME typing is committed to the URL after this many idle ms, so a burst
// of keystrokes produces one `router.replace` instead of one per keystroke.
const SEARCH_DEBOUNCE_MS = 350;

const ALL_GROUP_FILTERS: { value: BenefitSourceGroup | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "government", label: SOURCE_GROUP_LABELS.government },
  { value: "youth", label: SOURCE_GROUP_LABELS.youth },
  { value: "financial", label: SOURCE_GROUP_LABELS.financial },
];

/**
 * Pre-beta cleanup: the "금융상품" tab is hidden from the CURRENT selectable
 * group filters because no FSS financial provider is registered in
 * production (`providers/index.ts` only wires MOIS + Youth Center), so that
 * group always has 0 real records today. `BenefitSourceGroup = "financial"`,
 * `SOURCE_GROUP_LABELS.financial`, and `getSourceGroup()`'s financial bucket
 * are all deliberately kept (not removed) so this tab can come back the
 * moment FSS becomes a real provider — only the user-visible chip is hidden.
 * A direct `?group=financial` URL still parses and filters correctly
 * (`lib/benefits/listState.ts`'s `VALID_GROUPS` is unchanged); it's just not
 * offered as a clickable control.
 */
const GROUP_FILTERS = ALL_GROUP_FILTERS.filter((f) => f.value !== "financial");

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as BenefitCategory[];

/**
 * Pre-beta cleanup: "예금" is hidden from the CURRENT selectable category
 * chips because real frozen MOIS + Youth Center coverage is 0/13,712 (see
 * `lib/constants/interests.ts`'s `INTEREST_CATEGORIES`, which already
 * excludes it for onboarding for the same reason). `BenefitCategory =
 * "deposit"` and `CATEGORY_LABELS.deposit` are deliberately kept (not
 * removed) for future FSS integration — only the user-visible chip is
 * hidden. A direct `?category=deposit` URL still parses and filters
 * correctly (`lib/benefits/listState.ts`'s `VALID_CATEGORIES` is unchanged);
 * it's just not offered as a clickable control.
 */
const VISIBLE_CATEGORIES = ALL_CATEGORIES.filter((c) => c !== "deposit");

const SORT_OPTIONS: { value: BenefitSort; label: string }[] = [
  { value: "recommended", label: "추천순" },
  { value: "deadline", label: "마감임박순" },
  { value: "latest", label: "최신순" },
  { value: "rate", label: "금리순" },
];

/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * The URL is the durable source of truth for search/group/category/sort/page
 * (see lib/benefits/listState.ts) — this component reads it via
 * `useSearchParams` and writes to it via `router.replace` (no history entry
 * per keystroke/filter change), so a direct URL load, a refresh, or a
 * detail -> back navigation all reproduce the exact same controls/results.
 * Split out of page.tsx (a plain Server Component) specifically so the
 * `useSearchParams` call can be wrapped in a `<Suspense>` boundary, which
 * Next.js requires for a statically-prerenderable route.
 */
export function BenefitsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseListState(searchParams), [searchParams]);
  const { query, group, category, sort, page } = state;

  const replaceState = useCallback(
    (patch: Partial<BenefitListState>) => {
      const next: BenefitListState = { ...state, ...patch };
      const qs = buildListSearchParams(next).toString();
      router.replace(qs ? `/benefits?${qs}` : "/benefits", { scroll: false });
    },
    [state, router]
  );

  // The search input keeps its own local "draft" value, separate from the
  // URL-derived `query`. This is what makes Korean/Japanese/Chinese IME
  // composition work: while composing, only this local draft updates — the
  // URL (and therefore the component's re-render from `useSearchParams`)
  // isn't touched, so the browser's native composition session is never
  // interrupted mid-keystroke.
  const [draftQuery, setDraftQuery] = useState(query);
  const isComposingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // Any committed change to search invalidates the current page — go back to
  // page 1 rather than showing a now out-of-range page of stale results.
  const commitQuery = useCallback(
    (value: string) => {
      clearPendingDebounce();
      replaceState({ query: value, page: 1 });
    },
    [clearPendingDebounce, replaceState]
  );

  // Keep the draft in sync with the URL when it changes from outside this
  // input (back/forward navigation, a deep link, another control resetting
  // `q`, etc.) — but never while the user is mid-composition, or we'd wipe
  // out an in-progress Korean/Japanese/Chinese syllable.
  useEffect(() => {
    if (!isComposingRef.current) {
      setDraftQuery(query);
    }
  }, [query]);

  // Cancel any in-flight debounce timer on unmount so it can't fire (and
  // navigate) after the component is gone.
  useEffect(() => clearPendingDebounce, [clearPendingDebounce]);

  function handleQueryChange(value: string) {
    setDraftQuery(value);
    if (isComposingRef.current) {
      // Mid-composition: local draft only, no router.replace.
      return;
    }
    clearPendingDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      commitQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    // A composition starting mid-debounce should not let a stale, partial
    // value slip through once the timer fires.
    clearPendingDebounce();
  }

  function handleCompositionEnd(value: string) {
    isComposingRef.current = false;
    setDraftQuery(value);
    commitQuery(value);
  }

  function updateGroup(value: BenefitSourceGroup | "all") {
    replaceState({ group: value, page: 1 });
  }
  function updateCategory(value: BenefitCategory | "all") {
    replaceState({ category: value, page: 1 });
  }
  function updateSort(value: BenefitSort) {
    replaceState({ sort: value, page: 1 });
  }
  function goToPage(nextPage: number) {
    replaceState({ page: nextPage });
  }

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, search: query, group, category, sort }),
    [page, query, group, category, sort]
  );
  const { benefits: filtered, statusById, total, totalPages, loading, error } = usePaginatedBenefits(params);

  // The exact canonical current-list URL, carried into each detail link's
  // `returnTo` so BackLink returns here (see components/benefit/BenefitCard.tsx).
  const currentListUrl = useMemo(() => buildListUrl(state), [state]);

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
          value={draftQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={(e) => handleCompositionEnd(e.currentTarget.value)}
          placeholder="혜택, 기관명으로 검색"
          aria-label="혜택 검색"
          className="pl-11"
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none">
        {GROUP_FILTERS.map((f) => (
          <Chip key={f.value} selected={group === f.value} onClick={() => updateGroup(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none">
        <Chip selected={category === "all"} onClick={() => updateCategory("all")}>
          전체 카테고리
        </Chip>
        {VISIBLE_CATEGORIES.map((c) => (
          <Chip key={c} selected={category === c} onClick={() => updateCategory(c)}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-muted">{loading ? "불러오는 중" : `${total}개의 혜택`}</p>
        <Select
          aria-label="정렬"
          value={sort}
          onChange={(e) => updateSort(e.target.value as BenefitSort)}
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
        <>
          <div className="flex flex-col gap-3">
            {filtered.map((benefit) => (
              <BenefitCard
                key={benefit.id}
                benefit={benefit}
                status={statusById.get(benefit.id) ?? "unknown"}
                returnTo={currentListUrl}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(Math.max(page - 1, 1))}>
                이전
              </Button>
              <p className="text-xs text-foreground-muted">
                {page} / {totalPages}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => goToPage(Math.min(page + 1, totalPages))}
              >
                다음
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
