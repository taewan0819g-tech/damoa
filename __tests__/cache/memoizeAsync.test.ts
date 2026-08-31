import { describe, expect, it, vi } from "vitest";
import { memoizeAsync } from "@/lib/cache/memoizeAsync";

describe("memoizeAsync", () => {
  it("only calls the underlying function once within the TTL window", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const memoized = memoizeAsync(fn, 10_000);

    expect(await memoized(5)).toBe(10);
    expect(await memoized(5)).toBe(10);
    expect(await memoized(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent in-flight calls into a single underlying invocation", async () => {
    let resolveFn: (value: number) => void = () => {};
    const fn = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveFn = resolve;
        })
    );
    const memoized = memoizeAsync(fn, 10_000);

    const p1 = memoized();
    const p2 = memoized();
    resolveFn(42);

    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the underlying function after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn(async (x: number) => x);
      const memoized = memoizeAsync(fn, 1_000);

      await memoized(1);
      vi.advanceTimersByTime(1_001);
      await memoized(1);

      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cache a rejected call, so the next call retries", async () => {
    let shouldFail = true;
    const fn = vi.fn(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("boom");
      }
      return "ok";
    });
    const memoized = memoizeAsync(fn, 10_000);

    await expect(memoized()).rejects.toThrow("boom");
    expect(await memoized()).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
