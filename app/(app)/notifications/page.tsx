import { UserCheck, Bookmark, TrendingUp, ThumbsUp, Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getNotificationRepository, getReviewRepository, getSocialRepository } from "@/lib/repositories/factory";
import type { AppNotification, NotificationType } from "@/types/domain";

const ICONS: Record<NotificationType, typeof UserCheck> = {
  friend_request_accepted: UserCheck,
  saved_place_visited_by_friend: Bookmark,
  network_trend: TrendingUp,
  review_reaction: ThumbsUp,
};

async function resolveHref(notification: AppNotification): Promise<string> {
  if (notification.entityType === "place" && notification.entityId) return `/place/${notification.entityId}`;
  if (notification.entityType === "user" && notification.entityId) {
    const profile = await getSocialRepository().getProfile(notification.entityId);
    return profile ? `/profile/${profile.username}` : "/home";
  }
  if (notification.entityType === "review" && notification.entityId) {
    const review = await getReviewRepository().getById(notification.entityId);
    return review ? `/place/${review.placeId}` : "/home";
  }
  return "/home";
}

export default async function NotificationsPage() {
  const userId = (await getSessionUserId())!;
  const notifications = await getNotificationRepository().getByUser(userId);
  const sorted = [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const rows = await Promise.all(
    sorted.map(async (n) => ({
      notification: n,
      href: await resolveHref(n),
    }))
  );

  return (
    <div className="px-4 py-4">
      <h1 className="mb-4 text-lg font-bold text-foreground">알림</h1>

      {rows.length === 0 ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="아직 알림이 없어요" description="친구 활동이 생기면 여기서 알려드려요." />
      ) : (
        <div className="space-y-1">
          {rows.map(({ notification, href }) => {
            const Icon = ICONS[notification.type];
            return (
              <NotificationItem
                key={notification.id}
                id={notification.id}
                href={href}
                message={notification.message}
                timeLabel={formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: ko })}
                unread={!notification.readAt}
                icon={<Icon className="h-4 w-4" />}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
