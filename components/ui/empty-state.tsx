import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-6 py-12 text-center", className)}>
      {icon && <div className="mb-1 text-foreground-muted">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-foreground-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
