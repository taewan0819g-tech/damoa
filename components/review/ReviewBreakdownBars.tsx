import type { ReviewBreakdown } from "@/types/domain";

const LABELS: Record<keyof ReviewBreakdown, string> = {
  date: "데이트하기 좋아요",
  friends: "친구랑 가기 좋아요",
  solo: "혼자 가기 좋아요",
  family: "가족과 가기 좋아요",
  quiet: "조용히 대화하기 좋아요",
  value: "다시 갈 만해요",
};

/** Honest breakdown bars — only renders categories with signal, so a place
 * with 2 reviews doesn't imply confident percentages for everything. */
export function ReviewBreakdownBars({ breakdown }: { breakdown: ReviewBreakdown }) {
  const entries = (Object.keys(breakdown) as (keyof ReviewBreakdown)[])
    .map((key) => ({ key, pct: breakdown[key] }))
    .filter((e) => e.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {entries.map((e) => (
        <div key={e.key} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{LABELS[e.key]}</span>
            <span className="text-foreground-muted">{e.pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-accent" style={{ width: `${e.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
