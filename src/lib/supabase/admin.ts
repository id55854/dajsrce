import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";
import { createDataApiFetch, getDataApiUrl } from "@/lib/data-api/fetch";
import { serviceDataApiToken } from "@/lib/data-api/token";

const { url, anonKey } = getSupabasePublicConfig();

/**
 * Server-only client for service-role work. Its database calls reach the Neon
 * Data API with a `service_role` token (BYPASSRLS), the same trust Supabase's
 * service key carried. It has no Supabase Auth admin powers: the key it holds
 * is the public anon key, and nothing in the app uses `auth.admin`.
 */
export const supabaseAdmin = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: createDataApiFetch({
      supabaseUrl: url,
      dataApiUrl: getDataApiUrl(),
      getToken: serviceDataApiToken,
    }),
  },
});
