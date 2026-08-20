/** "다시 갈 의향" — honest about small samples (spec #74/#107). */
export function RevisitBadge({ rate, yesCount, sampleCount }: { rate: number | null; yesCount: number; sampleCount: number }) {
  if (sampleCount === 0 || rate === null) {
    return <span className="text-sm text-foreground-muted">재방문 의향 데이터가 아직 없어요</span>;
  }
  if (sampleCount < 5) {
    return (
      <span className="text-sm font-medium text-foreground">
        {sampleCount}명 중 {yesCount}명이 다시 가고 싶다고 했어요
      </span>
    );
  }
  return (
    <span className="text-sm font-medium text-foreground">
      다시 갈 의향 <span className="font-semibold text-accent">{Math.round(rate * 100)}%</span>
    </span>
  );
}
