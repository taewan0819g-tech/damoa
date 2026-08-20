import { AvatarStack } from "@/components/social/AvatarStack";
import { visitorSentence } from "@/lib/social/copy";
import type { SafeAuthor } from "@/types/domain";

export function FriendContext({
  visitors,
  totalCount,
  verb,
  className,
}: {
  visitors: SafeAuthor[];
  totalCount: number;
  verb?: string;
  className?: string;
}) {
  if (totalCount === 0) {
    return <p className={`text-sm text-foreground-muted ${className ?? ""}`}>아직 친구의 방문 기록이 없어요.</p>;
  }
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <AvatarStack authors={visitors} size={24} />
      <span className="text-sm font-medium text-foreground">{visitorSentence(visitors, totalCount, verb)}</span>
    </div>
  );
}
