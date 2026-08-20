"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_CURRENT_USER_ID } from "@/lib/demo/seedData";
import { ONBOARDED_COOKIE, SESSION_COOKIE } from "@/lib/auth/constants";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function signInDemo() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, DEMO_CURRENT_USER_ID, { maxAge: ONE_YEAR, path: "/" });
  const onboarded = cookieStore.get(ONBOARDED_COOKIE)?.value === "1";
  redirect(onboarded ? "/home" : "/onboarding");
}

export async function completeOnboarding() {
  const cookieStore = await cookies();
  cookieStore.set(ONBOARDED_COOKIE, "1", { maxAge: ONE_YEAR, path: "/" });
  redirect("/home");
}

export async function signOutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
