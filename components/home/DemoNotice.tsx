import { Info } from "lucide-react";

/** Only rendered when the currently loaded benefits are demo/mock data (no real API key configured) — hidden once real MOIS/청년 data is live. */
export function DemoNotice({ isDemo }: { isDemo: boolean }) {
  if (!isDemo) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-accent-soft px-4 py-3 text-xs leading-relaxed text-accent">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>현재 버전은 기능 테스트를 위한 데모 혜택 데이터를 사용하고 있습니다. 실제 정부·청년·금융 데이터는 다음 단계에서 연결됩니다.</p>
    </div>
  );
}
