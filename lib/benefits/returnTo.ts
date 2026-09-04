/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * Centralized safe-parsing for the detail page's `returnTo` query param.
 * `returnTo` lets a benefit detail page know exactly where to send the user
 * "back" to (the exact benefits-list URL, /home, or /saved) instead of
 * hardcoding /benefits. Since it's attacker-controllable input reflected
 * straight into a navigation target, it is validated against an explicit
 * allow-list of internal pathnames — NOT a generic "is this a relative URL"
 * check — so external redirects (`https://...`, `//evil.com`,
 * `javascript:...`, or anything else not on the allow-list) always fall back
 * to `/benefits`.
 */

const ALLOWED_RETURN_PATHNAMES = new Set(["/benefits", "/home", "/saved"]);

/** Extracts the pathname portion (before any `?query` or `#hash`) of a same-origin-relative path string. */
function pathnameOf(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * True only for a string that is safe to use as an internal client-side
 * navigation target: starts with exactly one `/` (rejects protocol-relative
 * `//host/...`), contains no backslashes (rejects browser-normalized
 * `\evil.com` tricks), and whose pathname (ignoring any query string) is one
 * of the known internal destinations. Anything else — absolute URLs,
 * `javascript:`/`data:` schemes, unknown paths — is rejected.
 */
export function isSafeReturnTo(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  if (raw.includes("\\")) return false;
  return ALLOWED_RETURN_PATHNAMES.has(pathnameOf(raw));
}

/** Resolves a raw `returnTo` value to a safe internal destination, falling back to `/benefits` for anything missing or invalid. */
export function resolveReturnTo(raw: string | null | undefined): string {
  return isSafeReturnTo(raw) ? raw : "/benefits";
}

/** Builds the `?returnTo=...` query-string fragment (including the leading `?`) to append to a detail page href, or "" if no destination is given. */
export function buildReturnToQuery(destination: string | undefined): string {
  if (!destination) return "";
  return `?returnTo=${encodeURIComponent(destination)}`;
}
