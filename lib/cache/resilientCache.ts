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
 *
 * Cold-start fix (post-Phase-5 pre-beta correction): a cache that has never
 * had ANY refresh attempt yet ("uninitialized"/"cold" — a brand-new process
 * that simply hasn't been asked for data yet) is a materially different
 * state from one that HAS attempted a refresh and failed with nothing to
 * fall back to ("unavailable" — a confirmed, attempted failure). Conflating
 * the two previously made `status` report "unavailable" for a provider that
 * had simply never been called yet, which caused the match route to return
 * a false 503 on a fresh process's very first request. `status` now
 * distinguishes "uninitialized" (never attempted: `lastAttemptAt === null`)
 * from "unavailable" (attempted at least once, no usable value).
 */

export type ResilientCacheStatus = "healthy" | "stale" | "unavailable" | "uninitialized";

export interface ResilientCacheDiagnostics {
  status: ResilientCacheStatus;
  /** When the most recent refresh attempt (success or failure) started, or null if never attempted. */
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  /** Age of the currently cached value in ms, or null if there is no cached value. */
  ageMs: number | null;
  /** Whether a refresh is currently in flight (safe to expose — never blocks/awaits anything). */
  refreshInFlight: boolean;
  /** Size of the current cached value per `opts.count`, or null if there's no value / no `count` was configured. */
  currentCount: number | null;
}

export interface ResilientCacheOptions<T> {
  /** How long a successfully-fetched value is considered fresh ("healthy"). */
  ttlMs: number;
  /** Cooldown after a failed refresh before another refresh attempt is triggered. Default 30_000ms. */
  cooldownMs?: number;
  /** Label used only for diagnostics/log context (never logs secrets). */
  label?: string;
  /** Optional sizing function (e.g. array length, Map size) surfaced as `currentCount` in diagnostics. Never exposes the value itself. */
  count?: (value: T) => number;
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

export function createResilientCache<T>(refresh: () => Promise<T>, opts: ResilientCacheOptions<T>): ResilientCache<T> {
  const ttlMs = opts.ttlMs;
  const cooldownMs = opts.cooldownMs ?? 30_000;

  let value: T | undefined;
  let valueFetchedAt: number | null = null;
  let inFlight: Promise<T> | null = null;
  let lastAttemptAt: number | null = null;
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
    // Set synchronously (before the first await below) so even a
    // diagnostics read that races the in-flight promise sees "an attempt is
    // underway/has happened", never "never attempted".
    lastAttemptAt = Date.now();
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
      // Never attempted at all vs. attempted-and-failed-with-nothing-to-
      // fall-back-to are materially different states -- see the module doc
      // comment. A brand-new process that hasn't been asked for data yet
      // must never be reported as a confirmed outage.
      status = lastAttemptAt === null ? "uninitialized" : "unavailable";
    } else if (isFresh()) {
      status = "healthy";
    } else {
      status = "stale";
    }
    return {
      status,
      lastAttemptAt,
      lastSuccessAt,
      lastFailureAt,
      lastError,
      ageMs: valueFetchedAt !== null ? Date.now() - valueFetchedAt : null,
      refreshInFlight: inFlight !== null,
      currentCount: value !== undefined && opts.count ? opts.count(value) : null,
    };
  }

  return { get, getDiagnostics };
}
