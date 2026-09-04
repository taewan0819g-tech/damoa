/**
 * Phase 5 (Production Stabilization) — shared upstream HTTP client.
 *
 * Centralizes the timeout + bounded-retry policy for calls to external
 * government APIs (api.odcloud.kr / youthcenter.go.kr) so every provider
 * gets the same resilience behavior instead of ad-hoc `fetch()` calls.
 *
 * IMPORTANT: this calls the *global* `fetch` (not a bound/imported
 * reference) so that existing tests using `vi.stubGlobal("fetch", ...)`
 * (see __tests__/providers/pagination.test.ts) continue to intercept
 * requests made through this helper without any test changes.
 *
 * Retry policy (documented per Phase 5 §7 requirement):
 *   - Retries ONLY on: network/fetch-throw errors, `AbortError` from our
 *     own timeout, HTTP 429, and HTTP 5xx responses. These are the classes
 *     of failure that are plausibly transient.
 *   - NEVER retries on other 4xx responses (400/401/403/404/etc.) — those
 *     are deterministic failures where retrying cannot help and would only
 *     waste time/quota.
 *   - Bounded: `retries` additional attempts after the first (default 2,
 *     so 3 attempts total), with exponential backoff (`baseDelayMs * 2^n`)
 *     plus full jitter, so a burst of concurrent callers doesn't retry in
 *     lockstep and hammer the upstream at the same instant.
 *   - Each individual attempt is bounded by `timeoutMs` via
 *     `AbortSignal.timeout()`; a timed-out attempt counts as a retryable
 *     failure.
 */

export class UpstreamHttpError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable: boolean; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "UpstreamHttpError";
    this.status = opts.status;
    this.retryable = opts.retryable;
  }
}

export interface FetchJsonWithRetryOptions {
  /** Per-attempt timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
  /** Number of ADDITIONAL attempts after the first (so total attempts = retries + 1). Default 2. */
  retries?: number;
  /** Base delay for exponential backoff, in milliseconds. Default 300. */
  baseDelayMs?: number;
  /** Short label used only in error messages/log context (e.g. "MOIS serviceList page 2"). Never logs secrets. */
  label?: string;
  /** Injectable sleep for deterministic tests; defaults to real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter: a random delay in [0, baseDelayMs * 2^attempt]. */
function backoffDelay(baseDelayMs: number, attempt: number): number {
  const cap = baseDelayMs * 2 ** attempt;
  return Math.random() * cap;
}

/**
 * Fetches `url` and parses the response as JSON, with a per-attempt timeout
 * and bounded retry on transient failures (see module doc comment for the
 * exact policy). Throws `UpstreamHttpError` on final failure.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  init?: RequestInit,
  opts?: FetchJsonWithRetryOptions
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const retries = opts?.retries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  const label = opts?.label ?? url;
  const sleep = opts?.sleep ?? defaultSleep;

  const totalAttempts = retries + 1;
  let lastError: UpstreamHttpError | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        const err = new UpstreamHttpError(`Upstream request failed for ${label}: HTTP ${response.status}`, {
          status: response.status,
          retryable,
        });
        if (!retryable || attempt === totalAttempts - 1) {
          throw err;
        }
        lastError = err;
        await sleep(backoffDelay(baseDelayMs, attempt));
        continue;
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof UpstreamHttpError) {
        throw err;
      }
      // Network error or AbortSignal timeout ("TimeoutError"/"AbortError") -- both retryable.
      const wrapped = new UpstreamHttpError(`Upstream request failed for ${label}: ${(err as Error)?.message ?? String(err)}`, {
        retryable: true,
        cause: err,
      });
      if (attempt === totalAttempts - 1) {
        throw wrapped;
      }
      lastError = wrapped;
      await sleep(backoffDelay(baseDelayMs, attempt));
    }
  }

  // Unreachable in practice (loop always throws or returns), but keeps TS happy.
  throw lastError ?? new UpstreamHttpError(`Upstream request failed for ${label}: unknown error`, { retryable: false });
}
