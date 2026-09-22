import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig, requireEnvironmentVariable } from "@/lib/env";

/**
 * Send recovery mail from the server so callers cannot choose the redirect
 * origin or bypass the application's mutation and rate-limit guards.
 */
export async function sendPasswordRecovery(email: string) {
  const { url, anonKey } = getSupabasePublicConfig();
  const appOrigin = new URL(requireEnvironmentVariable("NEXT_PUBLIC_APP_URL")).origin;
  const client = createClient(url, anonKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "dajsrce-password-recovery-request",
    },
  });

  return client.auth.resetPasswordForEmail(email, {
    redirectTo: `${appOrigin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
  });
}
