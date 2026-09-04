import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SOURCE_TYPE_LABELS } from "@/lib/labels";
import { buildReturnToQuery } from "@/lib/benefits/returnTo";
import type { Benefit, EligibilityStatus } from "@/types/benefit";

interface BenefitMiniRowProps {
  benefit: Benefit;
  /**
   * Optional preview status (see useMatchedBenefits' `statuses` map). A
   * benefit can be ranked into the home "recommended" bucket while still
   * being UNKNOWN-status (strong/moderate personalization evidence, but
   * eligibility itself isn't confirmed) — this must never look identical to
   * a confirmed match, so an "unknown" status renders a small, non-alarming
   * label. Never a Match Score, never "eligible", never a rule checklist —
   * just enough to say "worth a look, but check the details yourself".
   * Omitted entirely for likely_eligible/not_eligible (no label shown).
   */
  status?: EligibilityStatus;
  /** Where the detail page should navigate back to (e.g. `/home`). See BenefitCard's `returnTo`. */
  returnTo?: string;
}

export function BenefitMiniRow({ benefit, status, returnTo }: BenefitMiniRowProps) {
  return (
    <Link
      href={`/benefits/${benefit.id}${buildReturnToQuery(returnTo)}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 transition-colors hover:bg-surface-muted"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">{benefit.title}</p>
          {status === "unknown" && (
            <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
              확인이 필요해요
            </span>
          )}
        </div>
        <p className="text-xs text-foreground-muted">{benefit.institution?.name ?? SOURCE_TYPE_LABELS[benefit.source.type]}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
    </Link>
  );
}
