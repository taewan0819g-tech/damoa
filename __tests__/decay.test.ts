import { describe, expect, it } from "vitest";
import { daysBetween, mostRecent, recencyScore } from "@/lib/ranking/decay";

describe("recencyScore", () => {
  it("scores a visit happening right now at (essentially) 1", () => {
    expect(recencyScore(new Date().toISOString())).toBeCloseTo(1, 1);
  });

  it("decays toward 0 as the visit gets older", () => {
    const dayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(dayAgo)).toBeGreaterThan(recencyScore(monthAgo));
    expect(recencyScore(monthAgo)).toBeGreaterThan(recencyScore(yearAgo));
    expect(recencyScore(yearAgo)).toBeGreaterThanOrEqual(0);
  });

  it("decays by a factor of e^-1 after one half-life-days period (exp(-days/halfLife))", () => {
    const halfLife = 21;
    const oneHalfLifeAgo = recencyScore(new Date(Date.now() - halfLife * 24 * 60 * 60 * 1000).toISOString(), halfLife);
    expect(oneHalfLifeAgo).toBeCloseTo(Math.exp(-1), 2);
  });

  it("clamps to [0, 1] and never goes negative for far-future or far-past dates", () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(farFuture)).toBe(1);
    const farPast = new Date(Date.now() - 10000 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(farPast)).toBeGreaterThanOrEqual(0);
  });
});

describe("mostRecent", () => {
  it("returns null for an empty list", () => {
    expect(mostRecent([])).toBeNull();
  });

  it("picks the latest date regardless of input order", () => {
    const dates = ["2024-01-01T00:00:00.000Z", "2025-06-15T00:00:00.000Z", "2023-12-31T00:00:00.000Z"];
    expect(mostRecent(dates)).toBe("2025-06-15T00:00:00.000Z");
  });
});

describe("daysBetween", () => {
  it("computes an absolute day difference regardless of argument order", () => {
    const a = "2026-01-01T00:00:00.000Z";
    const b = "2026-01-11T00:00:00.000Z";
    expect(daysBetween(a, b)).toBeCloseTo(10, 5);
    expect(daysBetween(b, a)).toBeCloseTo(10, 5);
  });
});
