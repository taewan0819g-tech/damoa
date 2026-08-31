import { Badge } from "@/components/ui/badge";
import { ELIGIBILITY_STATUS_LABELS } from "@/lib/labels";
import type { EligibilityStatus } from "@/types/benefit";
import { cn } from "@/lib/utils/cn";

export function EligibilityBadge({ status, className }: { status: EligibilityStatus; className?: string }) {
  return (
    <Badge
      variant={status === "likely_eligible" ? "accent" : "outline"}
      className={cn(status === "not_eligible" && "text-foreground-muted", className)}
    >
      {ELIGIBILITY_STATUS_LABELS[status]}
    </Badge>
  );
}
