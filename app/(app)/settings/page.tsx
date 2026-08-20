import Link from "next/link";
import { ChevronRight, Lock, LogOut } from "lucide-react";
import { APP_NAME, DEMO_MODE } from "@/config/constants";
import { signOutAction } from "@/app/actions/auth";

export default function SettingsPage() {
  return (
    <div className="space-y-6 px-4 py-4">
      <h1 className="text-lg font-bold text-foreground">설정</h1>

      <section className="space-y-2">
        <Link
          href="/settings/privacy"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4"
        >
          <span className="flex items-center gap-3">
            <Lock className="h-4 w-4 text-foreground-muted" />
            <span className="text-sm font-medium text-foreground">공개 범위 설정</span>
          </span>
          <ChevronRight className="h-4 w-4 text-foreground-muted" />
        </Link>
      </section>

      <section>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-2xl border border-border p-4 text-sm font-medium text-foreground"
          >
            <LogOut className="h-4 w-4 text-foreground-muted" />
            로그아웃
          </button>
        </form>
      </section>

      <section className="pt-2 text-center text-xs text-foreground-muted">
        <p>{APP_NAME}</p>
        <p className="mt-0.5">{DEMO_MODE ? "데모 모드로 실행 중" : "v0.1.0"}</p>
      </section>
    </div>
  );
}
