"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfileStore } from "@/stores/profileStore";
import type { Benefit, BenefitMatchResult, EligibilityStatus } from "@/types/benefit";

interface UseMatchedBenefitsResult {
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  loading: boolean;
  error: boolean;
}

interface MatchState {
  profileKey: string;
  benefits: Benefit[];
  matches: BenefitMatchResult[];
  loading: boolean;
  error: boolean;
}

const DEBOUNCE_MS = 400;

/**
 * Loads the full benefit catalog together with per-benefit eligibility
 * status from the server via POST /api/benefits/match. Matching now runs
 * server-side (against the fully-paginated, server-cached catalog) instead
 * of the client fetching the whole catalog and evaluating locally, so the
 * client never needs its own copy of the rule engine's logic.
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
    benefits: [],
    matches: [],
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
        .then((data: { benefits: Benefit[]; matches: BenefitMatchResult[] }) => {
          if (cancelled) return;
          setState((prev) =>
            prev.profileKey === profileKey
              ? { ...prev, benefits: data.benefits, matches: data.matches, loading: false, error: false }
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

  const statusById = useMemo(() => new Map(state.matches.map((m) => [m.benefitId, m.status])), [state.matches]);

  return { benefits: state.benefits, statusById, loading: state.loading, error: state.error };
}
