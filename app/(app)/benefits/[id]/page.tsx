import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BenefitDetailClient } from "./BenefitDetailClient";

// `BenefitDetailClient` reads the `returnTo` param via `useSearchParams` (see
// lib/benefits/returnTo.ts) — Next.js requires that hook's usage to sit
// inside a `<Suspense>` boundary for the route to remain statically
// prerenderable in production builds. `id` itself comes from the (already
// server-resolved) route param, so it's passed down as a plain prop.
export default async function BenefitDetailPage({ params }: PageProps<"/benefits/[id]">) {
  const { id } = await params;

  return (
    <Suspense fallback={<BenefitDetailFallback />}>
      <BenefitDetailClient id={id} />
    </Suspense>
  );
}

function BenefitDetailFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-9 rounded-full" />
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
