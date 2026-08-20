import type { PrivacySettings, UUID } from "@/types/domain";
import type { PrivacyRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

export class DemoPrivacyRepository implements PrivacyRepository {
  async getSettings(userId: UUID): Promise<PrivacySettings> {
    return (
      demoStore.privacySettings[userId] ?? {
        userId,
        defaultVisitVisibility: "friends",
        defaultReviewVisibility: "friends",
        showVisitHistory: true,
        showToFriendsOfFriends: true,
        allowRecommendationUsage: true,
      }
    );
  }

  async updateSettings(userId: UUID, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    const current = await this.getSettings(userId);
    const updated = { ...current, ...patch };
    demoStore.privacySettings[userId] = updated;
    return updated;
  }
}
