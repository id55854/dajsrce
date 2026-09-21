import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";

/** Recovery emails must also work outside the browser that requested them. */
export async function sendPasswordRecovery(email: string, origin: string) {
  const { url, anonKey } = getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  // This isolated client only sends the email. It never stores a session or
  // changes the normal SSR client's PKCE flow for sign-in and OAuth.
  const client = createSupabaseClient(url, anonKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "dajsrce-password-recovery-request",
    },
  });
  return client.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
  });
}

/** Consume fragment tokens using the normal cookie-backed client. */
export async function establishRecoverySession(
  client: SupabaseClient,
  href: string,
  clearUrl: () => void
): Promise<string | null> {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const failed = [url.searchParams, fragment].some((params) =>
    ["error", "error_code", "error_description"].some((key) => params.has(key))
  );
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  const hasTokens = fragment.has("access_token") || fragment.has("refresh_token");
  // Remove credentials before awaiting any requests or rendering the form.
  clearUrl();
  if (failed) return null;
  if (hasTokens) {
    if (!accessToken || !refreshToken || fragment.get("type") !== "recovery") return null;
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return null;
  }
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user.email ?? "";
}
