import { describe, expect, it } from "vitest";
import {
  computeRecommendationScore,
  generateReasons,
  networkQuality,
  noveltyScore,
  revisitRate,
  socialProximityScore,
} from "@/lib/recommendations/recommendationService";
import type { Review } from "@/types/domain";

describe("socialProximityScore", () => {
  it("ranks closeness in the documented order: direct/self > FoF > shared circle > network > none", () => {
    const direct = socialProximityScore("direct_friend");
    const self = socialProximityScore("self");
    const fof = socialProximityScore("friend_of_friend");
    const circle = socialProximityScore("shared_circle");
    const network = socialProximityScore("network");
    const stranger = socialProximityScore("stranger");

    expect(self).toBe(direct);
    expect(direct).toBeGreaterThan(fof);
    expect(fof).toBeGreaterThan(circle);
    expect(circle).toBeGreaterThan(network);
    expect(network).toBeGreaterThan(stranger);
    expect(stranger).toBe(0);
  });
});

describe("networkQuality", () => {
  it("returns the neutral prior with zero confidence when there are no ratings", () => {
    const { adjustedRating, sampleSize } = networkQuality([]);
    expect(adjustedRating).toBeNull();
    expect(sampleSize).toBe(0);
  });

  it("shrinks a single 5-star rating toward the prior mean instead of trusting it outright", () => {
    const { adjustedRating } = networkQuality([5]);
    // With priorMean=3.4 and priorWeight=5, one 5-star review should pull the
    // adjusted rating up from the prior but land well short of a full 5.0 —
    // this is the mechanism that stops a single review from dominating.
    expect(adjustedRating).not.toBeNull();
    expect(adjustedRating!).toBeGreaterThan(3.4);
    expect(adjustedRating!).toBeLessThan(4.5);
  });

  it("converges toward the raw average as sample size grows", () => {
    const fewSamples = networkQuality([5]).adjustedRating!;
    const manySamples = networkQuality(Array(50).fill(5)).adjustedRating!;
    expect(manySamples).toBeGreaterThan(fewSamples);
    expect(manySamples).toBeGreaterThan(4.7);
  });
});

describe("noveltyScore", () => {
  it("scores a place the viewer already visited as zero novelty", () => {
    expect(noveltyScore(true, false)).toBe(0);
    expect(noveltyScore(true, true)).toBe(0);
  });

  it("scores a saved-but-unvisited place between fully novel and already-visited", () => {
    const saved = noveltyScore(false, true);
    const fresh = noveltyScore(false, false);
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThan(fresh);
    expect(fresh).toBe(1);
  });
});

describe("revisitRate", () => {
  it("returns null with no sample for an empty review list", () => {
    expect(revisitRate([])).toEqual({ rate: null, yesCount: 0, sampleCount: 0 });
  });

  it("computes the share of reviews that say they'd definitely revisit", () => {
    const reviews = [{ revisitIntention: "definitely" }, { revisitIntention: "definitely" }, { revisitIntention: "maybe" }, { revisitIntention: "no" }] as Review[];
    expect(revisitRate(reviews)).toEqual({ rate: 0.5, yesCount: 2, sampleCount: 4 });
  });
});

describe("computeRecommendationScore", () => {
  const baseInputs = {
    visitDates: [] as string[],
    tasteSimilarity: 0,
    ratings: [] as number[],
    hasViewerVisited: false,
    hasViewerSaved: false,
  };

  it("scores a place with direct-friend visitors higher than one with only network-distance visitors, all else equal", () => {
    const withFriends = computeRecommendationScore({ ...baseInputs, socialDistanceOfVisitors: ["direct_friend"] });
    const withNetwork = computeRecommendationScore({ ...baseInputs, socialDistanceOfVisitors: ["network"] });
    expect(withFriends.score).toBeGreaterThan(withNetwork.score);
  });

  it("scores a recently-visited place higher than a stale one, all else equal", () => {
    const recent = computeRecommendationScore({
      ...baseInputs,
      socialDistanceOfVisitors: ["direct_friend"],
      visitDates: [new Date().toISOString()],
    });
    const stale = computeRecommendationScore({
      ...baseInputs,
      socialDistanceOfVisitors: ["direct_friend"],
      visitDates: [new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()],
    });
    expect(recent.score).toBeGreaterThan(stale.score);
  });

  it("penalizes places the viewer has already visited via the novelty component only", () => {
    const unvisited = computeRecommendationScore({ ...baseInputs, socialDistanceOfVisitors: ["direct_friend"], hasViewerVisited: false });
    const visited = computeRecommendationScore({ ...baseInputs, socialDistanceOfVisitors: ["direct_friend"], hasViewerVisited: true });
    expect(unvisited.score).toBeGreaterThan(visited.score);
    // Every component except novelty should be identical — visiting a place
    // shouldn't retroactively change how socially close or well-rated it is.
    expect(unvisited.components.socialProximity).toBe(visited.components.socialProximity);
    expect(unvisited.components.networkQuality).toBe(visited.components.networkQuality);
    expect(visited.components.novelty).toBe(0);
  });

  it("never lets a single component push the score outside a sane [0, 1] range", () => {
    const maxed = computeRecommendationScore({
      socialDistanceOfVisitors: ["direct_friend"],
      visitDates: [new Date().toISOString()],
      tasteSimilarity: 1,
      ratings: Array(50).fill(5),
      hasViewerVisited: false,
      hasViewerSaved: false,
    });
    expect(maxed.score).toBeGreaterThan(0);
    expect(maxed.score).toBeLessThanOrEqual(1);
  });
});

describe("generateReasons", () => {
  it("leads with recent friend visits when present, and falls back to general network framing otherwise", () => {
    const withRecent = generateReasons({
      friendVisitCount: 3,
      recentFriendVisitCount: 2,
      tasteSimilarity: 0,
      circleTrend: false,
      quietTasteMatch: false,
    });
    expect(withRecent[0].code).toBe("recent_friend_visits");

    const withNothing = generateReasons({
      friendVisitCount: 0,
      recentFriendVisitCount: 0,
      tasteSimilarity: 0,
      circleTrend: false,
      quietTasteMatch: false,
    });
    expect(withNothing).toEqual([{ code: "general_network", label: expect.any(String) }]);
  });

  it("never exposes raw scoring weights or numbers in the reason labels", () => {
    const reasons = generateReasons({
      friendVisitCount: 5,
      recentFriendVisitCount: 5,
      tasteSimilarity: 0.9,
      circleTrend: true,
      quietTasteMatch: true,
    });
    for (const reason of reasons) {
      expect(reason.label).not.toMatch(/0\.\d|score|weight/i);
    }
  });
});
