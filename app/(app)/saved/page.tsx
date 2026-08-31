"use client";

import Link from "next/link";
import { Bookmark } from "lucide-react";
import { useSavedBenefits } from "@/hooks/useSavedBenefits";
import { useSavedBenefitStore } from "@/stores/savedBenefitStore";
import { BenefitCard } from "@/components/benefit/BenefitCard";
import { BenefitCardSkeleton } from "@/components/benefit/BenefitCardSkeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function SavedPage() {
  const { benefits: savedBenefits, statusById, loading, error } = useSavedBenefits();
  const savedIds = useSavedBenefitStore((s) => s.savedIds);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-foreground">저장한 혜택</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">나중에 다시 확인하고 싶은 혜택을 모아뒀어요.</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <BenefitCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="혜택 정보를 불러오지 못했어요." description="잠시 후 다시 시도해 주세요." />
      ) : savedIds.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="size-6" aria-hidden="true" />}
          title="아직 저장한 혜택이 없어요."
          description="관심있는 혜택을 저장하면 여기에서 모아볼 수 있어요."
          action={
            <Button asChild size="sm">
              <Link href="/benefits">혜택 둘러보기</Link>
            </Button>
          }
        />
      ) : savedBenefits.length === 0 ? (
        <EmptyState title="저장한 혜택을 찾을 수 없어요." description="목록에서 사라졌거나 변경되었을 수 있어요." />
      ) : (
        <div className="flex flex-col gap-3">
          {savedBenefits.map((benefit) => (
            <BenefitCard key={benefit.id} benefit={benefit} status={statusById.get(benefit.id) ?? "unknown"} />
          ))}
        </div>
      )}
    </div>
  );
}
