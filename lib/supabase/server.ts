import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side Supabase client bound to the current request's cookies. */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured — this should only be called outside Demo Mode.");
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // setAll is called from a Server Component sometimes — safe to ignore
          // because the proxy/middleware layer refreshes the session cookie.
        }
      },
    },
  });
}

/** Service-role client for privileged server-only operations (never exposed to the client). */
export async function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase service role is not configured.");
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
