import Link from "next/link";
import { Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getSocialRepository } from "@/lib/repositories/factory";

export default async function CirclesPage() {
  const userId = (await getSessionUserId())!;
  const social = getSocialRepository();
  const circles = await social.getCircles(userId);

  const withMembers = await Promise.all(
    circles.map(async (circle) => {
      const members = (await Promise.all(circle.memberIds.filter((id) => id !== userId).map((id) => social.getProfile(id)))).filter(
        (p): p is NonNullable<typeof p> => p !== null
      );
      return { circle, members };
    })
  );

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">모임</h1>
        <p className="mt-1 text-sm text-foreground-muted">함께 어울리는 친구 그룹의 활동이 홈 피드에 더 반영돼요.</p>
      </div>

      {withMembers.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="아직 속한 모임이 없어요" />
      ) : (
        <div className="space-y-3">
          {withMembers.map(({ circle, members }) => (
            <div key={circle.id} className="rounded-2xl border border-border p-4">
              <h2 className="text-sm font-semibold text-foreground">{circle.name}</h2>
              {circle.description ? <p className="mt-0.5 text-xs text-foreground-muted">{circle.description}</p> : null}
              <div className="mt-3 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {members.slice(0, 6).map((m) => (
                    <Link key={m.id} href={`/profile/${m.username}`}>
                      <Avatar src={m.avatarUrl} alt={m.displayName} size={28} />
                    </Link>
                  ))}
                </div>
                <span className="text-xs text-foreground-muted">멤버 {members.length + 1}명</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
