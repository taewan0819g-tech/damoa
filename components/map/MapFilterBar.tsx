import Link from "next/link";
import { CATEGORY_LABELS } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils/cn";
import type { MapFilter } from "@/lib/map/mapService";

const FILTERS: { value: MapFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "friends", label: "친구" },
  { value: "fof", label: "친구의 친구" },
  { value: "saved", label: "저장됨" },
  { value: "visited", label: "다녀온 곳" },
  ...(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((cat) => ({ value: cat as MapFilter, label: CATEGORY_LABELS[cat] })),
];

export function MapFilterBar({ activeFilter }: { activeFilter: MapFilter }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 px-3">
      <div className="pointer-events-auto flex gap-2 overflow-x-auto rounded-full scrollbar-none">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/map" : `/map?filter=${f.value}`}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-medium shadow-sm backdrop-blur transition-colors",
              activeFilter === f.value
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface/95 text-foreground-muted hover:border-accent/40"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
