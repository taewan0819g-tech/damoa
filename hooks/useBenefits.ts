"use client";

import { useEffect, useMemo, useState } from "react";
import { benefitProvider } from "@/providers";
import { matchBenefits } from "@/domain/eligibility/matchBenefits";
import { useProfileStore } from "@/stores/profileStore";
import type { Benefit, EligibilityStatus } from "@/types/benefit";

interface UseBenefitsResult {
  benefits: Benefit[];
  statusById: Map<string, EligibilityStatus>;
  loading: boolean;
  error: boolean;
}

/**
 * Loads the full benefit catalog once via the provider layer, then recomputes
 * eligibility status client-side whenever the user's profile changes — so
 * editing a profile field immediately re-evaluates every benefit without a
 * new fetch (per spec #29: matching auto-recalculates on profile edits).
 */
export function useBenefits(): UseBenefitsResult {
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const profile = useProfileStore((s) => s.profile);

  useEffect(() => {
    let cancelled = false;
    benefitProvider
      .getBenefits()
      .then((result) => {
        if (!cancelled) setBenefits(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusById = useMemo(() => {
    const results = matchBenefits(benefits, profile);
    return new Map(results.map((r) => [r.benefitId, r.status]));
  }, [benefits, profile]);

  return { benefits, statusById, loading, error };
}
