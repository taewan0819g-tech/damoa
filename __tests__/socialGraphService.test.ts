import { describe, expect, it } from "vitest";
import { getSharedCircles, getSocialDistance } from "@/lib/social/socialGraphService";
import { SEED_PLACES } from "@/lib/demo/seedData";
import { getPlaceSocialSummary } from "@/lib/social/socialGraphService";

/**
 * These run against the real Demo repositories and the deterministic demo
 * seed graph (fixed PRNG seed), so the fixture values below are actual
 * computed values, not assumptions — see u1's friend graph in
 * lib/demo/seedData.ts (TAEWAN_DIRECT_FRIENDS / SECOND_DEGREE_LINKS).
 */

describe("getSocialDistance", () => {
  it("is self for a user compared to themselves", async () => {
    expect(await getSocialDistance("u1", "u1")).toBe("self");
  });

  it("is direct_friend for u1's seeded direct friends", async () => {
    expect(await getSocialDistance("u1", "u2")).toBe("direct_friend");
    expect(await getSocialDistance("u1", "u7")).toBe("direct_friend");
  });

  it("is symmetric for direct friendships", async () => {
    expect(await getSocialDistance("u2", "u1")).toBe("direct_friend");
  });

  it("is friend_of_friend for a user two hops away", async () => {
    // u1 -> u2 -> u9 (u2 and u9 are direct friends per SECOND_DEGREE_LINKS)
    expect(await getSocialDistance("u1", "u9")).toBe("friend_of_friend");
    // u2 -> u1 -> u7 (u2 is not directly connected to u7)
    expect(await getSocialDistance("u2", "u7")).toBe("friend_of_friend");
  });

  it("falls back to network distance when there is no friend path within two hops", async () => {
    // u9's friends are u2/u5/u11; u3 isn't reachable from u9 within two hops
    // and they share no circle, so this is the general-network bucket.
    expect(await getSocialDistance("u9", "u3")).toBe("network");
  });
});

describe("getSharedCircles", () => {
  it("returns only circles both users belong to", async () => {
    const shared = await getSharedCircles("u1", "u2");
    // u1 and u2 are both members of "강원대 친구" (c1); u2 is not in c2/c3/c4.
    expect(shared.map((c) => c.id)).toContain("c1");
    expect(shared.every((c) => c.id !== "c4")).toBe(true);
  });

  it("returns nothing for users with no circle in common", async () => {
    const shared = await getSharedCircles("u9", "u3");
    expect(shared).toEqual([]);
  });
});

describe("getPlaceSocialSummary", () => {
  it("reflects zero activity for a place with no visits/reviews at all", async () => {
    // No real place has this id, so this exercises the "place not found /
    // no data" fallback path explicitly.
    const summary = await getPlaceSocialSummary("does-not-exist", "u1");
    expect(summary.friendVisitCount).toBe(0);
    expect(summary.trustedRating).toBeNull();
    expect(summary.recommendationScore).toBe(0);
  });

  it("gives the seeded 'magic moment' place a non-zero trusted rating and friend visit count for u1", async () => {
    const magicPlace = SEED_PLACES.find((p) => p.name === "미도인 성수")!;
    const summary = await getPlaceSocialSummary(magicPlace.id, "u1");
    expect(summary.friendVisitCount).toBeGreaterThan(0);
    expect(summary.trustedRating).not.toBeNull();
    expect(summary.recommendationScore).toBeGreaterThan(0);
    expect(summary.recommendationReasons.length).toBeGreaterThan(0);
  });
});
