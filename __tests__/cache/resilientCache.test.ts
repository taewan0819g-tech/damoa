import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResilientCache } from "@/lib/cache/resilientCache";

/**
 * Phase 5 (Production Stabilization) §19 regression coverage for
 * `lib/cache/resilientCache.ts` — the stale-if-error / last-known-good
 * cache backing the MOIS and Youth provider catalogs. Items 1-6 and 13 of
 * the §19 list are covered here at the generic-cache level (no live
 * upstream API involved anywhere in this file).
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resilientCache", () => {
  it("(1) a successful refresh caches the full value", async () => {
    const refresh = vi.fn(async () => [1, 2, 3]);
    const cache = createResilientCache(refresh, { ttlMs: 1000 });

    const value = await cache.get();

    expect(value).toEqual([1, 2, 3]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(cache.getDiagnostics().status).toBe("healthy");
  });

  it("(2) concurrent callers share one in-flight refresh (no duplicate upstream calls)", async () => {
    let resolveFn!: (v: number[]) => void;
    const refresh = vi.fn(() => new Promise<number[]>((resolve) => { resolveFn = resolve; }));
    const cache = createResilientCache(refresh, { ttlMs: 1000 });

    const p1 = cache.get();
    const p2 = cache.get();
    resolveFn([42]);
    const [v1, v2] = await Promise.all([p1, p2]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(v1).toBe(v2); // same array reference, not just deep-equal
  });

  it("(3) expired cache + successful refresh replaces the value", async () => {
    let n = 0;
    const refresh = vi.fn(async () => [++n]);
    const cache = createResilientCache(refresh, { ttlMs: 1000 });

    const first = await cache.get();
    vi.advanceTimersByTime(1500); // past TTL
    const second = await cache.get();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(first).toEqual([1]);
    expect(second).toEqual([2]);
    expect(second).not.toBe(first);
  });

  it("(4) expired cache + refresh failure returns the last-known-good value, unchanged", async () => {
    let call = 0;
    const refresh = vi.fn(async () => {
      call++;
      if (call === 1) return ["good"];
      throw new Error("upstream down");
    });
    const cache = createResilientCache(refresh, { ttlMs: 1000 });

    const first = await cache.get();
    vi.advanceTimersByTime(1500); // past TTL -> triggers a refresh attempt that fails
    const second = await cache.get();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(second).toBe(first); // exact same reference, not a new/rebuilt array
    expect(cache.getDiagnostics().status).toBe("stale");
    expect(cache.getDiagnostics().lastError).toBe("upstream down");
  });

  it("(5) a refresh failure never replaces a good cache with an empty array", async () => {
    let call = 0;
    const refresh = vi.fn(async () => {
      call++;
      if (call === 1) return [1, 2, 3];
      throw new Error("upstream down");
    });
    const cache = createResilientCache(refresh, { ttlMs: 1000 });

    await cache.get();
    vi.advanceTimersByTime(1500);
    const second = await cache.get();

    expect(second).toEqual([1, 2, 3]);
    expect(second.length).toBeGreaterThan(0);
  });

  it("(6) the very first refresh failing (no prior value) surfaces as unavailable", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("no data at all");
    });
    const cache = createResilientCache(refresh, { ttlMs: 1000 });

    await expect(cache.get()).rejects.toThrow("no data at all");
    expect(cache.getDiagnostics().status).toBe("unavailable");
    expect(cache.getDiagnostics().ageMs).toBeNull();
  });

  it("(13) cache preserves a stable array reference across repeated calls when no successful refresh has occurred", async () => {
    let call = 0;
    const refresh = vi.fn(async () => {
      call++;
      if (call === 1) return ["good"];
      throw new Error("still down");
    });
    // Long cooldown so repeated calls within the window don't re-trigger a refresh attempt.
    const cache = createResilientCache(refresh, { ttlMs: 1000, cooldownMs: 30_000 });

    const first = await cache.get();
    vi.advanceTimersByTime(1500); // expire TTL -> one failed refresh attempt happens
    const second = await cache.get();
    vi.advanceTimersByTime(5_000); // still well within the 30s cooldown
    const third = await cache.get();
    vi.advanceTimersByTime(5_000);
    const fourth = await cache.get();

    // Only ONE refresh attempt after the first success (the cooldown blocks the rest).
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fourth).toBe(first);
  });

  it("a stale value in cooldown is served as 'stale' health status (degraded), never silently reported healthy", async () => {
    let call = 0;
    const refresh = vi.fn(async () => {
      call++;
      if (call === 1) return ["good"];
      throw new Error("down");
    });
    const cache = createResilientCache(refresh, { ttlMs: 1000, cooldownMs: 30_000 });

    await cache.get();
    vi.advanceTimersByTime(1500);
    await cache.get(); // triggers + absorbs the failed refresh
    expect(cache.getDiagnostics().status).toBe("stale");
  });
});
