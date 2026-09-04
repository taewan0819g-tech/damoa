/**
 * Phase 5 (Production Stabilization) — resilient "stale-if-error" cache for
 * provider catalogs (MOIS service list, MOIS conditions map, Youth policy
 * catalog).
 *
 * This is a DIFFERENT concern from `lib/cache/memoizeAsync.ts`, which stays
 * as a generic short-TTL memoization primitive used elsewhere in the repo.
 * `resilientCache` specifically targets upstream-government-API catalogs,
 * where a transient upstream failure must never wipe out a previously good,
 * still-usable catalog — instead we serve the last-known-good value ("stale
 * -if-error") and surface degraded health via `getDiagnostics()`.
 *
 * Guarantees (see Phase 5 §19 regression tests for the exact behaviors):
 *  - A successful refresh caches the full result and becomes the new
 *    last-known-good value.
 *  - Concurrent callers while a refresh is in flight share the SAME
 *    in-flight promise (no duplicate upstream calls).
 *  - When the cached value has expired (TTL elapsed) and a refresh
 *    succeeds, the value is replaced.
 *  - When the cached value has expired and a refresh FAILS, the previous
 *    last-known-good value is returned as-is (never replaced with an
 *    empty/partial result, and never the SAME object identity mutated —
 *    literally the same reference is returned untouched).
 *  - The very first refresh (no prior last-known-good value) failing
 *    surfaces as a thrown error — there is nothing safe to fall back to.
 *  - After a failed refresh, a short cooldown window prevents immediately
 *    re-hammering the upstream on every subsequent SEQUENTIAL (non
 *    -concurrent) request; the stale value (or the failure) is served
 *    immediately until the cooldown elapses.
 */

export type ResilientCacheStatus = "healthy" | "stale" | "unavailable";

export interface ResilientCacheDiagnostics {
  status: ResilientCacheStatus;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  /** Age of the currently cached value in ms, or null if there is no cached value. */
  ageMs: number | null;
}

export interface ResilientCacheOptions {
  /** How long a successfully-fetched value is considered fresh ("healthy"). */
  ttlMs: number;
  /** Cooldown after a failed refresh before another refresh attempt is triggered. Default 30_000ms. */
  cooldownMs?: number;
  /** Label used only for diagnostics/log context (never logs secrets). */
  label?: string;
}

export interface ResilientCache<T> {
  /**
   * Returns the current value, refreshing if the cache is expired/empty
   * (subject to the in-flight-dedup and cooldown rules above). Throws only
   * when there is no usable value at all (no last-known-good AND the
   * current refresh attempt failed).
   */
  get(): Promise<T>;
  getDiagnostics(): ResilientCacheDiagnostics;
}

export function createResilientCache<T>(refresh: () => Promise<T>, opts: ResilientCacheOptions): ResilientCache<T> {
  const ttlMs = opts.ttlMs;
  const cooldownMs = opts.cooldownMs ?? 30_000;

  let value: T | undefined;
  let valueFetchedAt: number | null = null;
  let inFlight: Promise<T> | null = null;
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let lastError: string | null = null;

  function isFresh(): boolean {
    return valueFetchedAt !== null && Date.now() - valueFetchedAt < ttlMs;
  }

  function inCooldown(): boolean {
    return lastFailureAt !== null && Date.now() - lastFailureAt < cooldownMs;
  }

  function startRefresh(): Promise<T> {
    const attempt = (async () => {
      try {
        const result = await refresh();
        value = result;
        valueFetchedAt = Date.now();
        lastSuccessAt = valueFetchedAt;
        lastError = null;
        return result;
      } catch (err) {
        lastFailureAt = Date.now();
        lastError = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    inFlight = attempt;
    return attempt;
  }

  async function get(): Promise<T> {
    if (isFresh() && value !== undefined) {
      return value;
    }

    if (inFlight) {
      try {
        return await inFlight;
      } catch (err) {
        if (value !== undefined) return value;
        throw err;
      }
    }

    if (value !== undefined && inCooldown()) {
      // Stale-if-error: recently failed, don't re-trigger yet; serve last-known-good.
      return value;
    }

    try {
      return await startRefresh();
    } catch (err) {
      if (value !== undefined) {
        return value;
      }
      throw err;
    }
  }

  function getDiagnostics(): ResilientCacheDiagnostics {
    let status: ResilientCacheStatus;
    if (value === undefined) {
      status = "unavailable";
    } else if (isFresh()) {
      status = "healthy";
    } else {
      status = "stale";
    }
    return {
      status,
      lastSuccessAt,
      lastFailureAt,
      lastError,
      ageMs: valueFetchedAt !== null ? Date.now() - valueFetchedAt : null,
    };
  }

  return { get, getDiagnostics };
}
