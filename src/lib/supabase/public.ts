import { createClient } from "@supabase/supabase-js";

/**
 * Stateless client for cacheable public-data routes. It intentionally does not
 * read cookies or create an authenticated session, so public map requests do
 * not become personalised cache entries.
 */
export function createPublicSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Public Supabase configuration is missing");
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
