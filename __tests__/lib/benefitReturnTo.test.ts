import { describe, expect, it } from "vitest";
import { buildReturnToQuery, isSafeReturnTo, resolveReturnTo } from "@/lib/benefits/returnTo";

/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * `returnTo` is attacker-controllable (reflected straight from the URL into
 * a client-side navigation target), so it must be validated against an
 * explicit allow-list of internal destinations — never a generic
 * "looks relative" heuristic. Anything not exactly `/benefits`, `/home`, or
 * `/saved` (ignoring an optional `?query`) falls back to `/benefits`.
 */
describe("resolveReturnTo — safe internal destinations only", () => {
  it("passes through an exact current benefits-list URL with query params", () => {
    const url = "/benefits?category=housing&page=3";
    expect(resolveReturnTo(url)).toBe(url);
  });

  it("passes through /home and /saved", () => {
    expect(resolveReturnTo("/home")).toBe("/home");
    expect(resolveReturnTo("/saved")).toBe("/saved");
  });

  it("falls back to /benefits when returnTo is missing", () => {
    expect(resolveReturnTo(undefined)).toBe("/benefits");
    expect(resolveReturnTo(null)).toBe("/benefits");
    expect(resolveReturnTo("")).toBe("/benefits");
  });

  it.each([
    ["https://evil.com"],
    ["http://evil.com/benefits"],
    ["//evil.com"],
    ["//evil.com/benefits"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["/evil"],
    ["/benefits/../../etc/passwd"],
    ["benefits"],
    ["\\evil.com"],
    ["/\\evil.com"],
  ])("rejects malicious/unknown destination %s and falls back to /benefits", (raw) => {
    expect(isSafeReturnTo(raw)).toBe(false);
    expect(resolveReturnTo(raw)).toBe("/benefits");
  });

  it("rejects a returnTo whose pathname is an unrecognized nested path even under an allowed prefix's own name", () => {
    expect(resolveReturnTo("/benefits/123")).toBe("/benefits");
  });
});

describe("buildReturnToQuery", () => {
  it("returns an empty string for an undefined destination", () => {
    expect(buildReturnToQuery(undefined)).toBe("");
  });

  it("URL-encodes the destination into a ?returnTo= fragment", () => {
    expect(buildReturnToQuery("/benefits?category=housing&page=3")).toBe(
      `?returnTo=${encodeURIComponent("/benefits?category=housing&page=3")}`
    );
  });
});
