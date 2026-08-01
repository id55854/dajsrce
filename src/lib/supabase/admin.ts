import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig, requireEnvironmentVariable } from "@/lib/env";

const { url } = getSupabasePublicConfig();

export const supabaseAdmin = createClient(
  url,
  requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
