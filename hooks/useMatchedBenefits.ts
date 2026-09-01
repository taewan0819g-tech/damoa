"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfileStore } from "@/stores/profileStore";
import type { Benefit } from "@/types/benefit";
import type { BenefitSummary } from "@/domain/benefit/summary";

export interface MatchCounts {
  likelyEligible: number;
  unknown: number;
  notEligible: number;
  totalEvaluated: number;
  /** Benefits excluded from the personalized feed entirely (zero-positive-evidence unknown, upcoming, and/or expired). */
  excluded: number;
  candidatesEvaluated: number;
  activeCatalogCount: number;
  dateUnknownCatalogCount: number;
  expiredCatalogCount: number;
  upcomingCatalogCount: number;
}

interface UseMatchedBenefitsResult {
  /** Top recommended benefits (bounded preview — never the full relevant set, see the match route's home-summary shape). */
  recommended: Benefit[];
  /** Top "needs review" (unknown-status, positively-evidenced) benefits — also a bounded preview. */
  needsReview: Benefit[];
  /** Aggregate card counts, computed server-side over the FULL relevant set even though the arrays above are capped. */
  summary: BenefitSummary | null;
  counts: MatchCounts | null;
  loading: boolean;
  error: boolean;
}

interface HomeSummaryResponse {
  counts: MatchCounts;
  summary: BenefitSummary;
  recommended: Benefit[];
  needsReview: Benefit[];
}

interface MatchState {
  profileKey: string;
  recommended: Benefit[];
  needsReview: Benefit[];
  summary: BenefitSummary | null;
  counts: MatchCounts | null;
  loading: boolean;
  error: boolean;
}

const DEBOUNCE_MS = 400;
const INITIAL_STATE_BASE = { recommended: [] as Benefit[], needsReview: [] as Benefit[], summary: null, counts: null };

/**
 * Loads the bounded home-summary payload from POST /api/benefits/match (see
 * that route's non-paginated response shape). As of the fix for the "entire
 * relevant set sent to the browser just to display a handful of cards" bug
 * (section 20 of the constraint-compatibility spec), the server now does the
 * top-N selection AND the summary-card aggregation itself — this hook just
 * exposes the already-bounded `recommended`/`needsReview` arrays plus the
 * `summary` aggregate directly, instead of receiving thousands of Benefit
 * records and re-deriving those same six-to-ten-item lists client-side.
 *
 * Refetches whenever the profile changes, debounced: the profile form
 * updates the store on every keystroke, and each change now triggers a
 * network request rather than a free local recomputation, so firing on
 * every keystroke would hammer the endpoint.
 */
export function useMatchedBenefits(): UseMatchedBenefitsResult {
  const profile = useProfileStore((s) => s.profile);
  // Stable string key so state only resets when the profile's *content*
  // changes, not on every render (the store returns a new object reference
  // on every update() call even if values are equal).
  const profileKey = useMemo(() => JSON.stringify(profile), [profile]);

  const [state, setState] = useState<MatchState>({
    profileKey,
    ...INITIAL_STATE_BASE,
    loading: true,
    error: false,
  });

  // Reset synchronously during render when the profile changes (instead of
  // via an effect), so we never call setState unconditionally at the top of
  // an effect body — React's documented pattern for "adjusting state when a
  // prop/derived value changes", avoids an extra cascading render.
  if (state.profileKey !== profileKey) {
    setState((prev) => ({ ...prev, profileKey, loading: true, error: false }));
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetch("/api/benefits/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: profileKey,
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data: HomeSummaryResponse) => {
          if (cancelled) return;
          setState((prev) =>
            prev.profileKey === profileKey
              ? {
                  ...prev,
                  recommended: data.recommended,
                  needsReview: data.needsReview,
                  summary: data.summary,
                  counts: data.counts,
                  loading: false,
                  error: false,
                }
              : prev
          );
        })
        .catch((err) => {
          if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
          setState((prev) => (prev.profileKey === profileKey ? { ...prev, loading: false, error: true } : prev));
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [profileKey]);

  return {
    recommended: state.recommended,
    needsReview: state.needsReview,
    summary: state.summary,
    counts: state.counts,
    loading: state.loading,
    error: state.error,
  };
}
