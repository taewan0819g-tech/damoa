import { Avatar } from "@/components/ui/avatar";
import type { SafeAuthor } from "@/types/domain";

export function AvatarStack({ authors, extraCount, size = 28 }: { authors: SafeAuthor[]; extraCount?: number; size?: number }) {
  if (authors.length === 0) return null;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {authors.slice(0, 4).map((a) => (
          <Avatar key={a.id} src={a.avatarUrl} alt={a.displayName} fallback={a.displayName.slice(0, 1)} size={size} />
        ))}
      </div>
      {extraCount && extraCount > 0 ? (
        <span className="ml-2 text-xs font-medium text-foreground-muted">외 {extraCount}명</span>
      ) : null}
    </div>
  );
}
