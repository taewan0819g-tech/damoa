import type { Circle, UserProfile, UUID } from "@/types/domain";
import type { Relationship, SocialRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

export class DemoSocialRepository implements SocialRepository {
  async getProfile(userId: UUID): Promise<UserProfile | null> {
    return demoStore.users.find((u) => u.id === userId) ?? null;
  }

  async getProfileByUsername(username: string): Promise<UserProfile | null> {
    return demoStore.users.find((u) => u.username === username) ?? null;
  }

  async listUsers(): Promise<UserProfile[]> {
    return [...demoStore.users];
  }

  async getRelationships(userId: UUID): Promise<Relationship[]> {
    return demoStore.relationships.filter((r) => r.requesterId === userId || r.addresseeId === userId);
  }

  async isBlocked(userIdA: UUID, userIdB: UUID): Promise<boolean> {
    return demoStore.blocks.some(
      (b) => (b.blockerId === userIdA && b.blockedId === userIdB) || (b.blockerId === userIdB && b.blockedId === userIdA)
    );
  }

  async getCircles(userId: UUID): Promise<Circle[]> {
    return demoStore.circles.filter((c) => c.memberIds.includes(userId));
  }

  async addFriend(requesterId: UUID, addresseeId: UUID): Promise<void> {
    const existing = demoStore.relationships.find(
      (r) =>
        (r.requesterId === requesterId && r.addresseeId === addresseeId) ||
        (r.requesterId === addresseeId && r.addresseeId === requesterId)
    );
    if (existing) {
      existing.status = "accepted";
      return;
    }
    demoStore.relationships.push({
      id: demoStore.nextId("rel"),
      requesterId,
      addresseeId,
      status: "accepted",
      createdAt: new Date().toISOString(),
    });
  }
}
