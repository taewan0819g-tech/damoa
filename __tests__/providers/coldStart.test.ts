import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pre-beta correction regression coverage for the cold-start availability
 * bug: on a brand-new process, `createResilientCache`'s diagnostics used to
 * report `status: "unavailable"` for a provider that had simply never been
 * asked for data yet (no last-known-good value AND no attempt made), which
 * is indistinguishable from a confirmed, attempted upstream failure. Because
 * `POST /api/benefits/match` checked provider health BEFORE ever calling
 * `getCatalogWithCandidateIndex()`, a fresh process's very first request
 * would read every real provider as "unavailable" and return a preemptive
 * 503 -- the first catalog refresh was never even attempted.
 *
 * Fixed by:
 *  - `lib/cache/resilientCache.ts`: `status` now distinguishes
 *    "uninitialized" (never attempted -- `lastAttemptAt === null`) from
 *    "unavailable" (attempted at least once, no usable value).
 *  - `app/api/benefits/match/route.ts`: now attempts
 *    `getCatalogWithCandidateIndex()` FIRST (which drives each provider's
 *    first refresh attempt as a side effect), and only checks
 *    `getProviderHealth()` afterward -- by which point every registered
 *    provider has necessarily been attempted at least once.
 *  - `app/api/health/route.ts`: reports "starting" (200) rather than
 *    "unavailable" (503) when every provider is still "uninitialized",
 *    without ever itself triggering an upstream fetch.
 *
 * Every test here uses a completely fresh module graph per case
 * (`vi.resetModules()`) since the provider catalog caches are created once
 * at module-load time -- this is what makes "fresh process" simulable in a
 * single test run. No live upstream API is used anywhere in this file --
 * `fetch` is always stubbed.
 */

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A minimal, always-successful MOIS fetch stub: one serviceList record, empty supportConditions. */
function moisSuccessFetch(url: URL): Response | null {
  if (url.hostname !== "api.odcloud.kr") return null;
  if (url.pathname.endsWith("/supportConditions")) {
    return jsonResponse({ currentCount: 0, data: [], matchCount: 0, page: 1, perPage: 1000, totalCount: 0 });
  }
  if (url.pathname.endsWith("/serviceList")) {
    const data = [{ 서비스ID: "svc-1", 서비스명: "Test Service", 소관기관명: "Test Org" }];
    return jsonResponse({ currentCount: 1, data, matchCount: 1, page: 1, perPage: 1000, totalCount: 1 });
  }
  return null;
}

/** A deterministic (non-retryable), always-failing MOIS fetch stub. */
function moisFailFetch(url: URL): Response | null {
  if (url.hostname !== "api.odcloud.kr") return null;
  if (url.pathname.endsWith("/supportConditions")) {
    return jsonResponse({ currentCount: 0, data: [], matchCount: 0, page: 1, perPage: 1000, totalCount: 0 });
  }
  if (url.pathname.endsWith("/serviceList")) {
    return jsonResponse({ error: "bad request" }, 400);
  }
  return null;
}

/** A deterministic (non-retryable), always-failing Youth fetch stub. */
function youthFailFetch(url: URL): Response | null {
  if (url.hostname !== "www.youthcenter.go.kr") return null;
  return jsonResponse({ error: "bad request" }, 400);
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe("Cold-start: match route attempts catalog load before deciding 503", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
    delete process.env.YOUTH_POLICY_API_KEY;
  });

  it("(1) fresh process + a configured healthy provider: the first match request attempts catalog loading and SUCCEEDS instead of a preemptive 503", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const res = moisSuccessFetch(url);
      if (!res) throw new Error(`Unexpected URL in test: ${url.toString()}`);
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/benefits/match/route");
    const res = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));

    expect(res.status).toBe(200);
    // Proves the first refresh was actually attempted, not skipped.
    expect(fetchMock).toHaveBeenCalled();
  });

  it("(3) first refresh attempts and FAILS with no last-known-good data: match returns 503", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const res = moisFailFetch(url);
      if (!res) throw new Error(`Unexpected URL in test: ${url.toString()}`);
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/benefits/match/route");
    const res = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));

    expect(res.status).toBe(503);
    // The failure was a genuine attempt (not a cold skip).
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("Cold-start: mixed provider outcomes on first attempt", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
    process.env.YOUTH_POLICY_API_KEY = "test-key";
  });

  it("(4) one provider's first refresh succeeds and the other fails: match still succeeds using the healthy provider, and health reports degraded (not unavailable)", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const res = moisSuccessFetch(url) ?? youthFailFetch(url);
      if (!res) throw new Error(`Unexpected URL in test: ${url.toString()}`);
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/benefits/match/route");
    const matchRes = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));
    expect(matchRes.status).toBe(200);

    const { getProviderHealth } = await import("@/providers");
    const healths = getProviderHealth();
    const mois = healths.find((h) => h.provider === "mois");
    const youth = healths.find((h) => h.provider === "youth-center");
    expect(mois?.status).toBe("healthy");
    expect(youth?.status).toBe("unavailable");

    const { GET } = await import("@/app/api/health/route");
    const healthRes = await GET();
    const healthBody = (await healthRes.json()) as { status: string };
    expect(healthRes.status).toBe(200);
    expect(healthBody.status).toBe("degraded");
  });
});

describe("Cold-start: health endpoint semantics", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
    delete process.env.YOUTH_POLICY_API_KEY;
  });

  it("(2)+(6) a fresh process before any refresh: health endpoint is NOT a false 'unavailable' 503, and the health check itself never triggers an upstream fetch", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const res = moisSuccessFetch(url);
      if (!res) throw new Error(`Unexpected URL in test: ${url.toString()}`);
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = (await res.json()) as { status: string; providers: { status: string }[] };

    expect(res.status).toBe(200);
    expect(body.status).toBe("starting");
    expect(body.providers.every((p) => p.status === "uninitialized")).toBe(true);
    // The health check is a pure diagnostics read -- it must never itself
    // cause (or race) a provider's first real catalog fetch.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Cold-start adjacent: stale-if-error still works through the (reordered) match route", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MOIS_API_KEY = "test-key";
    delete process.env.YOUTH_POLICY_API_KEY;
  });

  it("(5) expired last-known-good + a failed refresh: the match route still serves the stale catalog (200), not a 503", async () => {
    vi.useFakeTimers();
    let phase: "ok" | "fail" = "ok";
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const res = phase === "ok" ? moisSuccessFetch(url) : moisFailFetch(url);
      if (!res) throw new Error(`Unexpected URL in test: ${url.toString()}`);
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/benefits/match/route");

    const first = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));
    expect(first.status).toBe(200);

    phase = "fail";
    vi.advanceTimersByTime(3_600_000 + 1_000); // past MOIS's 1-hour cache TTL

    const second = await POST(new Request("http://localhost/api/benefits/match", { method: "POST", body: "{}" }));
    // Stale-if-error: the last-known-good catalog is still served, so this
    // must NOT be a 503 even though the underlying refresh just failed.
    expect(second.status).toBe(200);

    const { getProviderHealth } = await import("@/providers");
    const mois = getProviderHealth().find((h) => h.provider === "mois");
    expect(mois?.status).toBe("stale");
  });
});
