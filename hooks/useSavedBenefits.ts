"use client";

import { useEffect, useMemo, useState } from "react";
import { matchBenefits } from "@/domain/eligibility/matchBenefits";
import { useProfileStore } from "@/stores/profileStore";
import { useSavedBenefitStore } from "@/stores/savedBenefitStore";
import type { Benefit, EligibilityStatus } from "@/types/benefit";

interface UseSavedBenefitsResult {
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  loading: boolean;
  error: boolean;
}

interface SavedState {
  idsKey: string;
  benefits: Benefit[];
  loading: boolean;
  error: boolean;
}

/**
 * Resolves the user's saved benefit IDs into full Benefit records by
 * fetching each one individually via the existing GET /api/benefits/[id]
 * route, in parallel. There's no full-catalog endpoint anymore (matching
 * moved server-side to POST /api/benefits/match, which is keyed off a
 * profile rather than a list of IDs), so the saved page resolves its own
 * small, bounded set of IDs directly instead of fetching the whole catalog
 * just to filter it down client-side.
 */
export function useSavedBenefits(): UseSavedBenefitsResult {
  const savedIds = useSavedBenefitStore((s) => s.savedIds);
  const profile = useProfileStore((s) => s.profile);

  // Stable key so state only resets when the actual set of saved IDs
  // changes, not on every render.
  const idsKey = useMemo(() => [...savedIds].sort().join(","), [savedIds]);

  const [state, setState] = useState<SavedState>({
    idsKey,
    benefits: [],
    loading: savedIds.length > 0,
    error: false,
  });

  // Reset synchronously during render when the saved-ID set changes
  // (instead of via an effect), so we never call setState unconditionally
  // at the top of an effect body.
  if (state.idsKey !== idsKey) {
    setState((prev) => ({
      idsKey,
      benefits: savedIds.length === 0 ? [] : prev.benefits,
      loading: savedIds.length > 0,
      error: false,
    }));
  }

  useEffect(() => {
    if (savedIds.length === 0) return;

    let cancelled = false;
    Promise.all(
      savedIds.map((id) =>
        fetch(`/api/benefits/${encodeURIComponent(id)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { benefit: Benefit } | null) => data?.benefit ?? null)
          .catch(() => null)
      )
    )
      .then((results) => {
        if (cancelled) return;
        setState((prev) =>
          prev.idsKey === idsKey
            ? { ...prev, benefits: results.filter((b): b is Benefit => b !== null), loading: false, error: false }
            : prev
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState((prev) => (prev.idsKey === idsKey ? { ...prev, loading: false, error: true } : prev));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const statusById = useMemo(() => {
    const results = matchBenefits(state.benefits, profile);
    return new Map(results.map((r) => [r.benefitId, r.status]));
  }, [state.benefits, profile]);

  return { benefits: state.benefits, statusById, loading: state.loading, error: state.error };
}
