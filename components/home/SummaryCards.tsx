import { Card } from "@/components/ui/card";
import type { BenefitSummary } from "@/domain/benefit/summary";

export function SummaryCards({ summary }: { summary: BenefitSummary }) {
  const items = [
    { label: "받을 가능성이 있는 혜택", value: summary.likelyEligibleCount },
    { label: "정부·청년 혜택", value: summary.governmentYouthCount },
    { label: "금융상품", value: summary.financialCount },
    { label: "곧 마감", value: summary.closingSoonCount },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <Card key={item.label} className="flex flex-col gap-1">
          <span className="text-xs text-foreground-muted">{item.label}</span>
          <span className="text-2xl font-bold text-foreground">{item.value}개</span>
        </Card>
      ))}
    </div>
  );
}
