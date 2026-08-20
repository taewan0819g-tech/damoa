import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="text-foreground-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-xs text-sm text-foreground-muted">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
