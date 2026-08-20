import type { AppNotification, UUID } from "@/types/domain";
import type { NotificationRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

export class DemoNotificationRepository implements NotificationRepository {
  async getByUser(userId: UUID): Promise<AppNotification[]> {
    return demoStore.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async markRead(notificationId: UUID): Promise<void> {
    const n = demoStore.notifications.find((x) => x.id === notificationId);
    if (n) n.readAt = new Date().toISOString();
  }
}
