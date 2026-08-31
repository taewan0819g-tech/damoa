import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface StepShellProps {
  step: number;
  totalSteps: number;
  title: string;
  description?: string;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children: ReactNode;
}

export function StepShell({
  step,
  totalSteps,
  title,
  description,
  onBack,
  onNext,
  nextLabel = "다음",
  nextDisabled,
  children,
}: StepShellProps) {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-6">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="이전 단계로"
            className="flex size-9 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-muted"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
        ) : (
          <div className="size-9" />
        )}
        <div className="flex-1">
          <Progress value={((step + 1) / totalSteps) * 100} />
        </div>
      </div>

      <div className="mt-8 flex flex-1 flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-foreground-muted">{description}</p>}
        </div>
        <div className="flex-1">{children}</div>
      </div>

      <Button size="lg" className="w-full" onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
      </Button>
    </div>
  );
}
