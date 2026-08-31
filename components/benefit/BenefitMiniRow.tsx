import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SOURCE_TYPE_LABELS } from "@/lib/labels";
import type { Benefit } from "@/types/benefit";

export function BenefitMiniRow({ benefit }: { benefit: Benefit }) {
  return (
    <Link
      href={`/benefits/${benefit.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 transition-colors hover:bg-surface-muted"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{benefit.title}</p>
        <p className="text-xs text-foreground-muted">{benefit.institution?.name ?? SOURCE_TYPE_LABELS[benefit.source.type]}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
    </Link>
  );
}
