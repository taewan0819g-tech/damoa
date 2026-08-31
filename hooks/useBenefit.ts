"use client";

import { useEffect, useState } from "react";
import { benefitProvider } from "@/providers";
import { matchBenefit } from "@/domain/eligibility/matchBenefits";
import { useProfileStore } from "@/stores/profileStore";
import type { Benefit, EligibilityStatus } from "@/types/benefit";

interface UseBenefitResult {
  benefit: Benefit | null;
  status: EligibilityStatus | null;
  loading: boolean;
  notFound: boolean;
}

interface BenefitState {
  id: string;
  benefit: Benefit | null;
  loading: boolean;
  notFound: boolean;
}

export function useBenefit(id: string): UseBenefitResult {
  const [state, setState] = useState<BenefitState>({ id, benefit: null, loading: true, notFound: false });

  // Reset synchronously during render when `id` changes (instead of via an
  // effect) so we never need an unconditional setState at the top of an effect.
  if (state.id !== id) {
    setState({ id, benefit: null, loading: true, notFound: false });
  }

  const profile = useProfileStore((s) => s.profile);

  useEffect(() => {
    let cancelled = false;
    benefitProvider
      .getBenefit(id)
      .then((result) => {
        if (cancelled) return;
        setState((prev) => (prev.id === id ? { ...prev, benefit: result, notFound: !result } : prev));
      })
      .finally(() => {
        if (!cancelled) {
          setState((prev) => (prev.id === id ? { ...prev, loading: false } : prev));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const status = state.benefit ? matchBenefit(state.benefit, profile).status : null;

  return { benefit: state.benefit, status, loading: state.loading, notFound: state.notFound };
}
