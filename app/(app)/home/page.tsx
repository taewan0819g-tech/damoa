"use client";

import { useMemo } from "react";
import { useBenefits } from "@/hooks/useBenefits";
import { useProfileStore } from "@/stores/profileStore";
import { getBenefitSummary } from "@/domain/benefit/summary";
import { getRecommendedBenefits } from "@/domain/benefit/recommend";
import { DemoNotice } from "@/components/home/DemoNotice";
import { SummaryCards } from "@/components/home/SummaryCards";
import { BenefitMiniRow } from "@/components/benefit/BenefitMiniRow";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export default function HomePage() {
  const { benefits, statusById, loading, error } = useBenefits();
  const profile = useProfileStore((s) => s.profile);
  const isDemo = benefits.length > 0 && benefits.every((b) => b.isDemo);

  const summary = useMemo(() => getBenefitSummary(benefits, statusById), [benefits, statusById]);
  const recommended = useMemo(
    () => getRecommendedBenefits(benefits, statusById, profile, 6),
    [benefits, statusById, profile]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">안녕하세요.</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">다모아가 지금 확인할 수 있는 혜택을 정리했어요.</p>
      </div>

      <DemoNotice isDemo={isDemo} />

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="혜택 정보를 불러오지 못했어요." description="잠시 후 다시 시도해 주세요." />
      ) : (
        <SummaryCards summary={summary} />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">다모아 추천</h2>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : recommended.length === 0 ? (
          <EmptyState
            title="현재 입력한 정보에서 확인되는 혜택이 없어요."
            description="내 정보에서 조건을 변경하거나 다른 카테고리를 확인해 보세요."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {recommended.map((benefit) => (
              <BenefitMiniRow key={benefit.id} benefit={benefit} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
