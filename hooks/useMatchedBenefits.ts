"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfileStore } from "@/stores/profileStore";
import type { Benefit, EligibilityStatus } from "@/types/benefit";

export interface MatchCounts {
  likelyEligible: number;
  unknown: number;
  notEligible: number;
  totalEvaluated: number;
  /** Benefits excluded from the personalized feed entirely (zero-evidence unknown and/or closed). */
  excluded: number;
}

interface UseMatchedBenefitsResult {
  /** likely_eligible + unknown benefits only — never includes not_eligible records. */
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  counts: MatchCounts | null;
  loading: boolean;
  error: boolean;
}

interface MatchResponse {
  likelyEligible: Benefit[];
  unknown: Benefit[];
  counts: MatchCounts;
}

interface MatchState {
  profileKey: string;
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  counts: MatchCounts | null;
  loading: boolean;
  error: boolean;
}

const DEBOUNCE_MS = 400;
const INITIAL_STATE_BASE = { benefits: [] as Benefit[], statusById: new Map<string, EligibilityStatus>(), counts: null };

/**
 * Loads eligibility-matched benefits from the server via
 * POST /api/benefits/match. As of the fix for the "entire catalog sent to
 * the browser" bug, the server only ever returns the likely_eligible and
 * unknown subsets (never not_eligible records, never the full catalog) —
 * this hook just combines those two arrays and derives a status map for
 * the existing display/sort/search helpers that expect one.
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
        .then((data: MatchResponse) => {
          if (cancelled) return;
          const benefits = [...data.likelyEligible, ...data.unknown];
          const statusById = new Map<string, EligibilityStatus>();
          for (const b of data.likelyEligible) statusById.set(b.id, "likely_eligible");
          for (const b of data.unknown) statusById.set(b.id, "unknown");
          setState((prev) =>
            prev.profileKey === profileKey
              ? { ...prev, benefits, statusById, counts: data.counts, loading: false, error: false }
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

  return { benefits: state.benefits, statusById: state.statusById, counts: state.counts, loading: state.loading, error: state.error };
}
