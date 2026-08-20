import { Star } from "lucide-react";

/** Honest-about-sample-size trusted rating display (spec #73/#107). Never
 * shows a confident "5.0" off a single review without qualifying it. */
export function NetworkRating({
  rating,
  count,
  size = "md",
  compact = false,
}: {
  rating: number | null;
  count: number;
  size?: "sm" | "md" | "lg";
  compact?: boolean;
}) {
  const textSize = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  if (count === 0 || rating === null) {
    return <span className="text-xs text-foreground-muted">평가 아직 없어요</span>;
  }
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Star className="h-3.5 w-3.5 fill-accent text-accent" />
        <span className="text-xs font-semibold text-foreground">{rating.toFixed(1)}</span>
        <span className="text-xs text-foreground-muted">({count})</span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-1.5">
      <Star className="h-4 w-4 fill-accent text-accent" />
      <span className={`${textSize} font-semibold text-foreground`}>{rating.toFixed(1)}</span>
      <span className="text-xs text-foreground-muted">{count === 1 ? "친구 1명의 평가" : `친구 평점 · ${count}개 평가`}</span>
    </div>
  );
}
