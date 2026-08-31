import Link from "next/link";
import { Wallet, Landmark, PiggyBank, Home as HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const HIGHLIGHTS = [
  { icon: Landmark, label: "정부·지자체 혜택" },
  { icon: Wallet, label: "청년정책" },
  { icon: PiggyBank, label: "예금·적금" },
  { icon: HomeIcon, label: "대출·주거" },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 py-10">
      <div />

      <div className="flex flex-col items-center gap-6 text-center">
        <span className="rounded-full bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent">다모아</span>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold leading-snug text-foreground">
            놓치는 혜택 없게,
            <br />
            다모아
          </h1>
          <p className="text-base leading-relaxed text-foreground-muted">
            몇 가지 정보만 알려주시면 지금 내 조건에 맞는
            <br />
            정부·청년·금융 혜택을 한곳에서 찾아드려요.
          </p>
        </div>

        <div className="mt-2 grid w-full grid-cols-4 gap-2">
          {HIGHLIGHTS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-1.5 rounded-card bg-surface p-3 text-center">
              <Icon className="size-5 text-accent" aria-hidden="true" />
              <span className="text-[11px] leading-tight text-foreground-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="w-full">
          <Link href="/onboarding">내 혜택 찾기</Link>
        </Button>
        <p className="text-center text-xs text-foreground-muted">
          현재 버전은 데모 데이터를 사용합니다. 주민등록번호, 계좌번호 등 민감정보는 입력받지 않아요.
        </p>
      </div>
    </main>
  );
}
