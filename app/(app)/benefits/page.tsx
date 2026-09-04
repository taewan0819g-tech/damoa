import { Suspense } from "react";
import { BenefitsPageClient } from "./BenefitsPageClient";
import { BenefitCardSkeleton } from "@/components/benefit/BenefitCardSkeleton";

// `BenefitsPageClient` reads/writes list state via `useSearchParams` (see
// lib/benefits/listState.ts) — Next.js requires that hook's usage to sit
// inside a `<Suspense>` boundary for the route to remain statically
// prerenderable in production builds.
export default function BenefitsPage() {
  return (
    <Suspense fallback={<BenefitsPageFallback />}>
      <BenefitsPageClient />
    </Suspense>
  );
}

function BenefitsPageFallback() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-foreground">혜택 모아보기</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">정부·청년·금융 혜택을 한곳에서 검색하고 비교해 보세요.</p>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <BenefitCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
