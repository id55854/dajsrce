import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "@/lib/env";
import { createDataApiFetch, getDataApiUrl } from "@/lib/data-api/fetch";
import { sessionDataApiToken } from "@/lib/data-api/session";

/**
 * Cookie-bound client: Auth calls go to Supabase, table/RPC calls go to the
 * Neon Data API as the signed-in user (or `anon` without a session).
 */
export async function createServerSupabaseClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();
  const client = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component, ignore
          }
        },
      },
      global: {
        fetch: createDataApiFetch({
          supabaseUrl: url,
          dataApiUrl: getDataApiUrl(),
          getToken: (): Promise<string> => sessionDataApiToken(client),
        }),
      },
    }
  );
  return client;
}
