import { afterEach, describe, expect, it } from "vitest";
import { canViewReview, canViewVisit, getAnonymitySetSize, getSafeReviewIdentity, toSafeReview } from "@/lib/privacy/privacyService";
import { getPrivacyRepository, getReviewRepository } from "@/lib/repositories/factory";
import { demoStore } from "@/lib/demo/store";
import { SEED_PLACES } from "@/lib/demo/seedData";
import type { Review, Visit } from "@/types/domain";

function visit(overrides: Partial<Visit>): Visit {
  return { id: "v-test", userId: "u2", placeId: "p1", visitedAt: new Date().toISOString(), visibility: "friends", photoUrl: null, companionIds: [], ...overrides };
}

function review(overrides: Partial<Review>): Review {
  return {
    id: "r-test",
    userId: "u2",
    placeId: "p1",
    visitId: null,
    rating: 4,
    reviewText: "좋았어요",
    revisitIntention: "definitely",
    priceRating: null,
    noiseRating: null,
    waitRating: null,
    tags: [],
    visibility: "friends",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Scenario A — private content is never visible to anyone but its owner.
describe("private visibility (scenario A)", () => {
  it("hides a private visit from a direct friend but shows it to its owner", async () => {
    const v = visit({ userId: "u2", visibility: "private" });
    expect(await canViewVisit("u1", v)).toBe(false); // u1 is a direct friend of u2
    expect(await canViewVisit("u2", v)).toBe(true);
  });

  it("hides a private review from a direct friend but shows it to its owner", async () => {
    const r = review({ userId: "u2", visibility: "private" });
    expect(await canViewReview("u1", r)).toBe(false);
    expect(await canViewReview("u2", r)).toBe(true);
  });
});

// Scenario B — "friends" visibility is limited to direct friends (and shared
// circles); a friend-of-friend is one hop too far for review visibility.
describe("friends visibility (scenario B)", () => {
  it("is visible to a direct friend", async () => {
    const v = visit({ userId: "u2", visibility: "friends" });
    expect(await canViewVisit("u1", v)).toBe(true); // u1<->u2 direct
  });

  it("is not visible to a user at general network distance", async () => {
    const r = review({ userId: "u3", visibility: "friends" });
    expect(await canViewReview("u9", r)).toBe(false); // u9<->u3 is "network"
  });

  it("review visibility does not extend to friends-of-friends (stricter than visit visibility)", async () => {
    // u2 <-> u7 is friend_of_friend (verified in socialGraphService.test.ts)
    const r = review({ userId: "u7", visibility: "friends" });
    expect(await canViewReview("u2", r)).toBe(false);
  });
});

// Scenario C — friend-of-friend visibility for visits is gated by the
// visit owner's own showToFriendsOfFriends privacy setting.
describe("friend-of-friend visibility is opt-in (scenario C)", () => {
  const sharerId = "u9"; // u1 <-> u9 is friend_of_friend

  afterEach(async () => {
    await getPrivacyRepository().updateSettings(sharerId, { showToFriendsOfFriends: true });
  });

  it("is visible to a friend-of-friend when the sharer opted in (default)", async () => {
    const v = visit({ userId: sharerId, visibility: "friends" });
    expect(await canViewVisit("u1", v)).toBe(true);
  });

  it("is hidden from a friend-of-friend once the sharer opts out", async () => {
    await getPrivacyRepository().updateSettings(sharerId, { showToFriendsOfFriends: false });
    const v = visit({ userId: sharerId, visibility: "friends" });
    expect(await canViewVisit("u1", v)).toBe(false);
  });
});

// Scenario D — k-anonymity gates the identity label on anonymous reviews,
// independent of how close the viewer is to the true author.
describe("k-anonymity on anonymous reviews (scenario D)", () => {
  it("falls back to a fully generic identity when the anonymity set is below the threshold", async () => {
    const kAnonPlace = SEED_PLACES[3]; // 연희동 라멘식당 — seeded with exactly one other visible visitor
    const setSize = await getAnonymitySetSize(kAnonPlace.id);
    expect(setSize).toBeLessThan(4);

    const r = await getReviewRepository().getById("r-kanon-1");
    expect(r).not.toBeNull();
    // Viewer u1 is a *direct friend* of the true author (u2) — closeness
    // alone must not be enough to earn a more specific label than "generic"
    // once the anonymity set is too small.
    const { displayIdentity, author } = await getSafeReviewIdentity("u1", r!);
    expect(displayIdentity).toBe("LocalGraph 사용자");
    expect(author).toBeNull();
  });

  it("labels by social distance once the anonymity set clears the threshold, but never leaks the author", async () => {
    const magicPlace = SEED_PLACES.find((p) => p.name === "미도인 성수")!;
    const setSize = await getAnonymitySetSize(magicPlace.id);
    expect(setSize).toBeGreaterThanOrEqual(4);

    const r = await getReviewRepository().getById("r-magic-3"); // authored by u7
    expect(r).not.toBeNull();

    const asDirectFriend = await getSafeReviewIdentity("u1", r!); // u1<->u7 direct
    expect(asDirectFriend.displayIdentity).toBe("친구 네트워크 사용자");
    expect(asDirectFriend.author).toBeNull();

    const asFriendOfFriend = await getSafeReviewIdentity("u2", r!); // u2<->u7 FoF
    expect(asFriendOfFriend.displayIdentity).toBe("친구의 친구");
    expect(asFriendOfFriend.author).toBeNull();
  });

  it("toSafeReview never attaches an author to network_anonymous content, even for the closest possible viewer", async () => {
    const r = await getReviewRepository().getById("r-magic-3");
    const safe = await toSafeReview("u1", r!);
    expect(safe.isAnonymous).toBe(true);
    expect(safe.author).toBeNull();
    expect(safe.approximateTime).not.toBe(r!.createdAt); // bucketed, not exact
  });
});

// Scenario E — a block overrides every other visibility rule, in both directions.
describe("blocking overrides visibility (scenario E)", () => {
  afterEach(() => {
    demoStore.blocks.length = 0;
  });

  it("hides even public content from a blocked viewer", async () => {
    demoStore.blocks.push({ blockerId: "u2", blockedId: "u1" });
    const v = visit({ userId: "u2", visibility: "public" });
    expect(await canViewVisit("u1", v)).toBe(false);
    const r = review({ userId: "u2", visibility: "public" });
    expect(await canViewReview("u1", r)).toBe(false);
  });

  it("blocks are symmetric regardless of who initiated the block", async () => {
    demoStore.blocks.push({ blockerId: "u1", blockedId: "u2" });
    const v = visit({ userId: "u2", visibility: "public" });
    expect(await canViewVisit("u1", v)).toBe(false);
  });
});
