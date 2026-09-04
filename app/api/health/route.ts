import { NextResponse } from "next/server";
import { getProviderHealth } from "@/providers";
import { logger } from "@/lib/log/logger";

/**
 * Phase 5 (Production Stabilization) — read-only health/diagnostics
 * endpoint. Never exposes secret values (API keys), only per-provider
 * cache freshness/error state (see providers/health.ts's `ProviderHealth`).
 *
 * This endpoint stays cheap and NEVER triggers an upstream refresh itself --
 * it only reads each provider's already-computed `getHealthStatus()`
 * diagnostics (a synchronous cache read), so a deployment health probe
 * hitting this endpoint can never be what causes (or blocks) a provider's
 * first real catalog fetch. See `getProviderHealth()`/`getHealthStatus()`
 * in providers/*.ts -- none of them call `.get()` on a resilientCache.
 *
 * Overall status:
 *   - "starting"     every registered provider is "uninitialized" (a brand
 *                     -new process that simply hasn't had its first catalog
 *                     request yet -- NOT a confirmed outage; the very next
 *                     `/api/benefits/match` request is expected to trigger
 *                     each provider's first refresh)
 *   - "healthy"      every registered provider's own status is "healthy"
 *   - "degraded"      a mix of statuses where at least one provider has
 *                     SOME usable data or hasn't been attempted yet (matches
 *                     the match route's own vacuous-truth-guarded "not every
 *                     provider is unavailable" definition of a usable
 *                     catalog)
 *   - "unavailable"  every registered provider has ACTUALLY BEEN ATTEMPTED
 *                     and reports "unavailable" (a confirmed, attempted
 *                     failure with no last-known-good data anywhere) -- or
 *                     no providers are registered at all, which should not
 *                     happen in practice since MockBenefitProvider is always
 *                     registered as a fallback.
 *
 * HTTP status: 200 for "healthy"/"degraded"/"starting" (the service can
 * still serve requests -- possibly with stale data, or by triggering a
 * first-ever fetch), 503 only for "unavailable".
 */
export async function GET() {
  const providers = getProviderHealth();

  const allUninitialized = providers.length > 0 && providers.every((p) => p.status === "uninitialized");
  const allAttemptedAndUnavailable = providers.length > 0 && providers.every((p) => p.status === "unavailable");
  const allHealthy = providers.length > 0 && providers.every((p) => p.status === "healthy");

  let overall: "healthy" | "degraded" | "starting" | "unavailable";
  if (providers.length === 0) {
    overall = "unavailable";
  } else if (allUninitialized) {
    overall = "starting";
  } else if (allAttemptedAndUnavailable) {
    overall = "unavailable";
  } else if (allHealthy) {
    overall = "healthy";
  } else {
    overall = "degraded";
  }

  if (overall === "unavailable") {
    logger.error("health_check", { overall, providerCount: providers.length });
  }

  return NextResponse.json(
    { status: overall, providers, checkedAt: new Date().toISOString() },
    { status: overall === "unavailable" ? 503 : 200 }
  );
}
