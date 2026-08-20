import { NextResponse, type NextRequest } from "next/server";
import { PROTECTED_PREFIXES, SESSION_COOKIE } from "@/lib/auth/constants";
import { DEMO_MODE } from "@/config/constants";

/**
 * Next.js 16 renamed `middleware` to `proxy`. This guards authenticated
 * routes; Demo Mode still requires the explicit "데모로 시작하기" step on
 * /login so the sign-in flow is demonstrable, but never blocks on a real
 * backend being configured (spec #45/#52).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession && !DEMO_MODE) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|avatars|.*\\..*).*)"],
};
