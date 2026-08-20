import "server-only";
import { cookies } from "next/headers";
import { DEMO_CURRENT_USER_ID } from "@/lib/demo/seedData";
import { DEMO_MODE } from "@/config/constants";
import { getSocialRepository } from "@/lib/repositories/factory";
import { ONBOARDED_COOKIE, SESSION_COOKIE } from "./constants";
import type { UserProfile } from "@/types/domain";

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const uid = cookieStore.get(SESSION_COOKIE)?.value;
  if (uid) return uid;
  // In Demo Mode, fall back to the primary demo persona so the product is
  // explorable even before a cookie is set (e.g. server-rendered previews).
  return DEMO_MODE ? DEMO_CURRENT_USER_ID : null;
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const uid = await getSessionUserId();
  if (!uid) return null;
  return getSocialRepository().getProfile(uid);
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ONBOARDED_COOKIE)?.value === "1";
}
