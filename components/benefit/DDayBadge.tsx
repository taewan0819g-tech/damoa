import { Badge } from "@/components/ui/badge";
import { getDDayInfo } from "@/lib/dates/dday";
import { cn } from "@/lib/utils/cn";

export function DDayBadge({ endDate, className }: { endDate?: string; className?: string }) {
  const info = getDDayInfo(endDate);
  if (!info) return null;

  return (
    <Badge
      variant="outline"
      className={cn(
        info.kind === "upcoming" && info.days <= 7 && "border-danger text-danger",
        className
      )}
    >
      신청 {info.label}
    </Badge>
  );
}
