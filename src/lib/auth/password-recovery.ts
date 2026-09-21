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

/**
 * How long a recovery-flavoured session is trusted to open the new-password
 * form. Supabase mints the access token with `amr: [{ method: "recovery",
 * timestamp }]` when it is established via a recovery link, and that claim
 * survives token refresh for the life of the session — so without a recency
 * bound, someone who reset their password weeks ago and stayed signed in
 * could still reach this form on that same old proof.
 */
const RECOVERY_SESSION_MAX_AGE_MINUTES = 60;

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  return atob(pad ? base64 + "=".repeat(4 - pad) : base64);
}

/**
 * A session merely existing is not proof of a recovery request: an already
 * signed-in visitor who simply types this page's URL in also has a valid
 * session. Only the `amr` claim Supabase stamps on a recovery-minted access
 * token proves that, so the form only opens for a session carrying a fresh
 * one, regardless of how that session was reached (fragment tokens set
 * locally, or a cookie session the server callback already established).
 */
function hasFreshRecoveryClaim(accessToken: string): boolean {
  const payload = accessToken.split(".")[1];
  if (!payload) return false;
  let claims: { amr?: { method?: string; timestamp?: number }[] };
  try {
    claims = JSON.parse(base64UrlDecode(payload));
  } catch {
    return false;
  }
  const timestamps = (claims.amr ?? [])
    .filter((entry) => entry.method === "recovery" && typeof entry.timestamp === "number")
    .map((entry) => entry.timestamp as number);
  if (timestamps.length === 0) return false;
  const latest = Math.max(...timestamps);
  return Date.now() / 1000 - latest < RECOVERY_SESSION_MAX_AGE_MINUTES * 60;
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
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (error || !session) return null;
  if (!hasFreshRecoveryClaim(session.access_token)) return null;
  return session.user.email ?? "";
}
