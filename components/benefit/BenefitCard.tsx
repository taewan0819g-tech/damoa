import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SaveButton } from "./SaveButton";
import { EligibilityBadge } from "./EligibilityBadge";
import { DDayBadge } from "./DDayBadge";
import { DemoBadge } from "./DemoBadge";
import { getSourceGroup } from "@/domain/benefit/sourceGroup";
import { SOURCE_TYPE_LABELS } from "@/lib/labels";
import { formatPercent } from "@/lib/utils/format";
import type { Benefit, EligibilityStatus } from "@/types/benefit";

interface BenefitCardProps {
  benefit: Benefit;
  status: EligibilityStatus;
}

export function BenefitCard({ benefit, status }: BenefitCardProps) {
  const group = getSourceGroup(benefit);
  const isFinancial = group === "financial";

  return (
    <Link href={`/benefits/${benefit.id}`} className="block">
      <Card className="flex flex-col gap-3 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{SOURCE_TYPE_LABELS[benefit.source.type]}</Badge>
            {benefit.isDemo && <DemoBadge />}
          </div>
          <SaveButton benefitId={benefit.id} />
        </div>

        <h3 className="text-base font-semibold leading-snug text-foreground">{benefit.title}</h3>

        {isFinancial ? (
          <>
            <p className="text-sm text-foreground-muted">{benefit.institution?.name ?? benefit.source.organization}</p>
            <FinancialSummary benefit={benefit} />
          </>
        ) : (
          <>
            <EligibilityBadge status={status} />
            <p className="text-sm text-foreground-muted">
              {benefit.financial?.amountDescription ?? benefit.shortDescription}
            </p>
            <DDayBadge endDate={benefit.application?.endDate} />
          </>
        )}

        <span className="text-sm font-medium text-accent">자세히 보기 →</span>
      </Card>
    </Link>
  );
}

function FinancialSummary({ benefit }: { benefit: Benefit }) {
  const { financial } = benefit;
  if (!financial) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {financial.loanInterestRate !== undefined && (
        <span className="font-semibold text-foreground">{formatPercent(financial.loanInterestRate)}~</span>
      )}
      {financial.interestRate !== undefined && (
        <span className="text-foreground-muted">기본 {formatPercent(financial.interestRate)}</span>
      )}
      {financial.maxInterestRate !== undefined && financial.maxInterestRate !== financial.interestRate && (
        <span className="font-semibold text-accent">최고 {formatPercent(financial.maxInterestRate)}</span>
      )}
      {financial.periodMonths !== undefined && (
        <span className="text-foreground-muted">{financial.periodMonths}개월</span>
      )}
    </div>
  );
}
