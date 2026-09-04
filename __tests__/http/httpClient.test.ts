import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithRetry, UpstreamHttpError } from "@/lib/http/httpClient";

/**
 * Phase 5 (Production Stabilization) §19 item 8 regression coverage: an
 * HTTP timeout must behave exactly like any other transient/retryable
 * refresh failure. Also covers the broader retry-policy contract (retry on
 * network/timeout/429/5xx, never on other 4xx) so future changes to
 * `httpClient.ts` can't silently start retrying deterministic client
 * errors. Uses `vi.stubGlobal("fetch", ...)` (never a live upstream API) —
 * the same pattern already relied on by __tests__/providers/pagination.test.ts.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const noopSleep = async () => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJsonWithRetry", () => {
  it("succeeds on the first attempt without retrying", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry<{ ok: boolean }>("https://example.test/x", undefined, { sleep: noopSleep });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("(8) a timeout/abort error is treated as retryable and a subsequent success is returned", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) {
        const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        throw err;
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry<{ ok: boolean }>("https://example.test/x", undefined, {
      retries: 2,
      sleep: noopSleep,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 500 and eventually succeeds", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse({ error: "boom" }, 500);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry<{ ok: boolean }>("https://example.test/x", undefined, {
      retries: 2,
      sleep: noopSleep,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 429 and eventually succeeds", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse({ error: "rate limited" }, 429);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithRetry<{ ok: boolean }>("https://example.test/x", undefined, {
      retries: 2,
      sleep: noopSleep,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a deterministic 404 -- fails immediately on the first attempt", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJsonWithRetry("https://example.test/x", undefined, { retries: 2, sleep: noopSleep })
    ).rejects.toThrow(UpstreamHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a deterministic 400 -- fails immediately", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "bad request" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJsonWithRetry("https://example.test/x", undefined, { retries: 2, sleep: noopSleep })
    ).rejects.toThrow(UpstreamHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting bounded retries and throws UpstreamHttpError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "boom" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJsonWithRetry("https://example.test/x", undefined, { retries: 2, sleep: noopSleep })
    ).rejects.toThrow(UpstreamHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
