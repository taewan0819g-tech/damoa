import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function BenefitCardSkeleton() {
  return (
    <Card className="flex flex-col gap-3">
      <Skeleton className="h-5 w-16" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-4 w-full" />
    </Card>
  );
}
