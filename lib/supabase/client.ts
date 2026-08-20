import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Only used when Supabase env vars are present. */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured — this should only be called outside Demo Mode.");
  }
  return createBrowserClient(url, anonKey);
}
