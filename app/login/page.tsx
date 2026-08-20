import { redirect } from "next/navigation";
import { getSessionUserId, hasCompletedOnboarding } from "@/lib/auth/session";
import { signInDemo } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { APP_NAME, APP_TAGLINE, APP_SUBTAGLINE, DEMO_MODE } from "@/config/constants";

export default async function LoginPage() {
  const userId = await getSessionUserId();
  if (userId) {
    const onboarded = await hasCompletedOnboarding();
    redirect(onboarded ? "/home" : "/onboarding");
  }

  return (
    <div className="flex min-h-dvh flex-col justify-between bg-background px-6 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{APP_NAME}</h1>
          <p className="mt-3 text-lg font-medium text-foreground">{APP_TAGLINE}</p>
          <p className="mt-1.5 text-sm text-foreground-muted">{APP_SUBTAGLINE}</p>
        </div>

        {DEMO_MODE ? (
          <div className="space-y-3">
            <form action={signInDemo}>
              <Button type="submit" size="lg" className="w-full">
                데모로 시작하기
              </Button>
            </form>
            <p className="text-center text-xs text-foreground-muted">
              실제 계정 없이 태완님의 친구 네트워크로 바로 둘러볼 수 있어요.
            </p>
          </div>
        ) : (
          <form className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">이메일</Label>
              <Input id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">비밀번호</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" />
            </div>
            <Button type="submit" size="lg" className="w-full">
              로그인
            </Button>
          </form>
        )}
      </div>

      <p className="text-center text-xs text-foreground-muted">계속하면 서비스 이용약관과 개인정보 처리방침에 동의하게 됩니다.</p>
    </div>
  );
}
