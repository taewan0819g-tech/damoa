/**
 * A minimal in-process TTL cache with in-flight de-duplication, for
 * memoizing expensive async work (e.g. paginating an entire external API)
 * across requests within a single server process.
 *
 * We can't use Next's `unstable_cache`/`"use cache"` here: `unstable_cache`
 * requires Next's request/render context to supply an `incrementalCache`
 * (confirmed by direct testing — it throws `Invariant: incrementalCache
 * missing` when called outside that context, which is exactly how these
 * provider-layer functions are invoked), and `"use cache"` requires opting
 * into `cacheComponents`, which this project does not enable. This is a
 * deliberately simple substitute: single-process, no cross-instance
 * invalidation, good enough for an MVP's server-side data cache.
 *
 * Concurrent calls while a fetch is in flight share the same promise
 * instead of triggering duplicate upstream requests (important here since
 * a burst of `/api/benefits/match` requests can otherwise all try to
 * paginate the same external API at once before the first one finishes).
 */
export function memoizeAsync<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  ttlMs: number
): (...args: Args) => Promise<T> {
  let cached: { value: T; expiresAt: number } | undefined;
  let inFlight: Promise<T> | undefined;

  return async (...args: Args): Promise<T> => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    if (inFlight) {
      return inFlight;
    }

    const promise = fn(...args)
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });

    inFlight = promise;
    return promise;
  };
}
