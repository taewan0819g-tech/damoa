import type { ResilientCacheStatus } from "@/lib/cache/resilientCache";

/**
 * Phase 5 (Production Stabilization) — per-provider health/diagnostics
 * shape, surfaced (without secrets) via `GET /api/health` and used by the
 * match route to decide whether the merged catalog is usable at all.
 *
 * Providers implement this via an OPTIONAL duck-typed `getHealthStatus()`
 * method rather than a breaking change to `BenefitProvider` — the interface
 * itself stays a stable, minimal contract (see providers/BenefitProvider.ts).
 */
export interface ProviderHealth {
  /** Short machine-readable provider id, e.g. "mois", "youth-center", "mock". */
  provider: string;
  /** Whether the provider has the env configuration (API key) needed to call the real upstream. */
  configured: boolean;
  status: ResilientCacheStatus;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  ageMs: number | null;
}

/** Duck-typed interface a concrete provider MAY implement for health reporting. */
export interface HealthReportingProvider {
  getHealthStatus(): ProviderHealth;
}

export function hasHealthStatus(provider: unknown): provider is HealthReportingProvider {
  return typeof (provider as Partial<HealthReportingProvider>)?.getHealthStatus === "function";
}
