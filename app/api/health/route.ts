import { NextResponse } from "next/server";
import { getProviderHealth } from "@/providers";
import { logger } from "@/lib/log/logger";

/**
 * Phase 5 (Production Stabilization) — read-only health/diagnostics
 * endpoint. Never exposes secret values (API keys), only per-provider
 * cache freshness/error state (see providers/health.ts's `ProviderHealth`).
 *
 * Overall status:
 *   - "healthy"     every registered provider's own status is "healthy"
 *   - "degraded"     at least one provider is "stale" or "unavailable", but
 *                     at least one provider still has SOME usable data
 *                     (matches the match route's own vacuous-truth-guarded
 *                     "not every provider is unavailable" definition of a
 *                     usable catalog)
 *   - "unavailable"  every registered provider reports "unavailable" (or no
 *                     providers are registered at all, which should not
 *                     happen in practice since MockBenefitProvider is
 *                     always registered as a fallback)
 *
 * HTTP status: 200 for "healthy"/"degraded" (the service can still serve
 * requests, possibly with stale data), 503 for "unavailable".
 */
export async function GET() {
  const providers = getProviderHealth();

  let overall: "healthy" | "degraded" | "unavailable";
  if (providers.length === 0 || providers.every((p) => p.status === "unavailable")) {
    overall = "unavailable";
  } else if (providers.every((p) => p.status === "healthy")) {
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
