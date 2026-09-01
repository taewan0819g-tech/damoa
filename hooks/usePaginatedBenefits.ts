"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfileStore } from "@/stores/profileStore";
import type { BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import type { BenefitSort } from "@/domain/benefit/sort";
import type { Benefit, BenefitCategory, EligibilityStatus } from "@/types/benefit";
import type { MatchCounts } from "./useMatchedBenefits";

export interface PaginatedBenefitsParams {
  page: number;
  pageSize: number;
  search: string;
  group: BenefitSourceGroup | "all";
  category: BenefitCategory | "all";
  sort: BenefitSort;
}

interface UsePaginatedBenefitsResult {
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  counts: MatchCounts | null;
  total: number;
  totalPages: number;
  loading: boolean;
  error: boolean;
}

interface PaginatedResponse {
  benefits: Benefit[];
  statuses: Record<string, EligibilityStatus>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: MatchCounts;
}

interface PaginatedState {
  requestKey: string;
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  counts: MatchCounts | null;
  total: number;
  totalPages: number;
  loading: boolean;
  error: boolean;
}

const DEBOUNCE_MS = 400;
const INITIAL_STATE_BASE = {
  benefits: [] as Benefit[],
  statusById: new Map<string, EligibilityStatus>(),
  counts: null,
  total: 0,
  totalPages: 0,
};

/**
 * Server-driven counterpart to `useMatchedBenefits`, for the benefits
 * listing page: instead of fetching the whole personalized-relevant set and
 * filtering/sorting/paginating it client-side, it sends `page`/`pageSize`
 * (plus `search`/`group`/`category`/`sort`) to POST /api/benefits/match,
 * which switches to the paginated response shape (see route.ts) and does
 * all of that server-side over the already-evidence-filtered,
 * closed-excluded relevant set.
 *
 * Refetches whenever the profile OR any of the paging/filter params change,
 * debounced for the same reason as useMatchedBenefits (profile form updates
 * on every keystroke).
 */
export function usePaginatedBenefits(params: PaginatedBenefitsParams): UsePaginatedBenefitsResult {
  const profile = useProfileStore((s) => s.profile);
  const requestKey = useMemo(() => JSON.stringify({ profile, ...params }), [profile, params]);

  const [state, setState] = useState<PaginatedState>({
    requestKey,
    ...INITIAL_STATE_BASE,
    loading: true,
    error: false,
  });

  if (state.requestKey !== requestKey) {
    setState((prev) => ({ ...prev, requestKey, loading: true, error: false }));
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetch("/api/benefits/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestKey,
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data: PaginatedResponse) => {
          if (cancelled) return;
          const statusById = new Map<string, EligibilityStatus>(Object.entries(data.statuses));
          setState((prev) =>
            prev.requestKey === requestKey
              ? {
                  ...prev,
                  benefits: data.benefits,
                  statusById,
                  counts: data.counts,
                  total: data.total,
                  totalPages: data.totalPages,
                  loading: false,
                  error: false,
                }
              : prev
          );
        })
        .catch((err) => {
          if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
          setState((prev) => (prev.requestKey === requestKey ? { ...prev, loading: false, error: true } : prev));
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey]);

  return {
    benefits: state.benefits,
    statusById: state.statusById,
    counts: state.counts,
    total: state.total,
    totalPages: state.totalPages,
    loading: state.loading,
    error: state.error,
  };
}
