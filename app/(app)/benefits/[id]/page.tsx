"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useBenefit } from "@/hooks/useBenefit";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { EligibilityBadge } from "@/components/benefit/EligibilityBadge";
import { DDayBadge } from "@/components/benefit/DDayBadge";
import { DemoBadge } from "@/components/benefit/DemoBadge";
import { SaveButton } from "@/components/benefit/SaveButton";
import { ExternalLinkButton } from "@/components/benefit/ExternalLinkButton";
import { getSourceGroup } from "@/domain/benefit/sourceGroup";
import { SOURCE_TYPE_LABELS, BENEFIT_TYPE_LABELS } from "@/lib/labels";
import { formatDateRange } from "@/lib/dates/dday";
import { formatKRW, formatPercent } from "@/lib/utils/format";
import type { BenefitFinancial } from "@/types/benefit";

export default function BenefitDetailPage({ params }: PageProps<"/benefits/[id]">) {
  const { id } = use(params);
  const { benefit, status, loading, notFound } = useBenefit(id);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (notFound || !benefit || !status) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState title="혜택 정보를 찾을 수 없어요." description="삭제되었거나 잘못된 주소일 수 있어요." />
      </div>
    );
  }

  const group = getSourceGroup(benefit);
  const isFinancial = group === "financial";
  const dateRange = formatDateRange(benefit.application?.startDate, benefit.application?.endDate);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <BackLink />
        <SaveButton benefitId={benefit.id} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{SOURCE_TYPE_LABELS[benefit.source.type]}</Badge>
          <Badge variant="outline">{BENEFIT_TYPE_LABELS[benefit.benefitType]}</Badge>
          {benefit.isDemo && <DemoBadge />}
        </div>
        <h1 className="text-xl font-bold leading-snug text-foreground">{benefit.title}</h1>
        <p className="text-sm text-foreground-muted">{benefit.institution?.name ?? benefit.source.organization}</p>
        {!isFinancial && <EligibilityBadge status={status} />}
        <p className="text-sm leading-relaxed text-foreground-muted">{benefit.shortDescription}</p>
      </div>

      {benefit.financial && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">혜택 안내</h2>
          {benefit.financial.amountDescription && (
            <p className="text-sm leading-relaxed text-foreground-muted">{benefit.financial.amountDescription}</p>
          )}
          <FinancialDetails financial={benefit.financial} />
        </Card>
      )}

      {(dateRange || benefit.application?.endDate) && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">신청 기간</h2>
          <div className="flex flex-wrap items-center gap-2">
            {dateRange && <p className="text-sm text-foreground-muted">{dateRange}</p>}
            <DDayBadge endDate={benefit.application?.endDate} />
          </div>
        </Card>
      )}

      {benefit.requiredDocuments && benefit.requiredDocuments.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">필요 서류</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-foreground-muted">
            {benefit.requiredDocuments.map((doc) => (
              <li key={doc} className="flex items-center gap-2">
                <span className="size-1 shrink-0 rounded-full bg-foreground-muted" aria-hidden="true" />
                {doc}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {benefit.tags && benefit.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {benefit.tags.map((tag) => (
            <Badge key={tag}>#{tag}</Badge>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <ExternalLinkButton href={benefit.application?.applicationUrl} label="신청하러 가기" variant="primary" />
        <ExternalLinkButton href={benefit.application?.officialUrl} label="공식 안내 페이지" variant="outline" />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/benefits"
      aria-label="목록으로 돌아가기"
      className="flex size-9 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-muted"
    >
      <ChevronLeft className="size-5" aria-hidden="true" />
    </Link>
  );
}

function FinancialDetails({ financial }: { financial: BenefitFinancial }) {
  const rows: { label: string; value: string }[] = [];
  if (financial.interestRate !== undefined) rows.push({ label: "기본 금리", value: formatPercent(financial.interestRate) });
  if (financial.maxInterestRate !== undefined)
    rows.push({ label: "최고 금리", value: formatPercent(financial.maxInterestRate) });
  if (financial.loanInterestRate !== undefined)
    rows.push({ label: "대출 금리", value: `${formatPercent(financial.loanInterestRate)}~` });
  if (financial.minAmount !== undefined) rows.push({ label: "최소 금액", value: formatKRW(financial.minAmount) });
  if (financial.maxAmount !== undefined) rows.push({ label: "최대 금액", value: formatKRW(financial.maxAmount) });
  if (financial.periodMonths !== undefined) rows.push({ label: "기간", value: `${financial.periodMonths}개월` });

  if (rows.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-foreground-muted">{row.label}</dt>
          <dd className="text-sm font-semibold text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
