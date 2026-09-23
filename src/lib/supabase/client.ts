import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";
import { createDataApiFetch, getDataApiUrl } from "@/lib/data-api/fetch";

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.NEXT_PUBLIC_DATA_API_URL
);

type BrowserClient = SupabaseClient;

/**
 * The browser cannot sign Data API tokens, so it asks this app for one. A
 * token is tied to the Supabase access token it was issued for: signing in,
 * out or refreshing the session fetches a fresh one.
 */
let cachedToken: { session: string | null; token: string; exp: number } | null = null;
let inflight: { session: string | null; promise: Promise<string> } | null = null;

async function browserDataApiToken(client: BrowserClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const session = data.session?.access_token ?? null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.session === session && cachedToken.exp - 60 > now) {
    return cachedToken.token;
  }
  if (inflight && inflight.session === session) return inflight.promise;

  const promise = (async () => {
    const response = await fetch("/api/auth/data-token", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as { token?: string; exp?: number } | null;
    if (!response.ok || !body?.token || typeof body.exp !== "number") {
      throw new Error("data_api_token_unavailable");
    }
    cachedToken = { session, token: body.token, exp: body.exp };
    return body.token;
  })();
  inflight = { session, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

export function createClient(): BrowserClient {
  // Next.js only inlines NEXT_PUBLIC_* references that are statically visible.
  const { url, anonKey } = getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  const client: BrowserClient = createBrowserClient(url, anonKey, {
    auth: {
      // The reset page explicitly consumes and clears its fragment once.
      // Automatic URL detection can otherwise race that operation.
      detectSessionInUrl: typeof window === "undefined" || window.location.pathname !== "/auth/reset-password",
    },
    global: {
      fetch: createDataApiFetch({
        supabaseUrl: url,
        dataApiUrl: getDataApiUrl({ NEXT_PUBLIC_DATA_API_URL: process.env.NEXT_PUBLIC_DATA_API_URL }),
        getToken: () => browserDataApiToken(client),
      }),
    },
  });
  return client;
}
