// Shared service-role Supabase client + tiny env loader so scripts can be run
// directly with `node scripts/foo.mjs` without `dotenv`.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { dataApiFetch } from "./data-api.mjs";

function loadEnvLocal() {
  // Try cwd/.env.local first, then walk up.
  const tried = [];
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, ".env.local");
    tried.push(p);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const k = m[1];
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in process.env)) process.env[k] = v;
      }
      return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

loadEnvLocal();

// The database is Neon; supabase-js is kept for its query builder only. Its
// requests reach the Neon Data API as service_role (BYPASSRLS). The URL is just
// the prefix the fetch rewrites, so no Supabase credential is needed here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://supabase.invalid";
if (!process.env.NEXT_PUBLIC_DATA_API_URL || !process.env.DATA_API_JWT_PRIVATE_JWK) {
  console.error("Missing NEXT_PUBLIC_DATA_API_URL or DATA_API_JWT_PRIVATE_JWK in .env.local");
  process.exit(1);
}

export const supabaseAdmin = createClient(url, "service-role-via-data-api", {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: dataApiFetch(url, "service_role") },
});

/** A stateless client that reads as the public `anon` role. */
export function createPublicDataClient() {
  return createClient(url, "anon-via-data-api", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: dataApiFetch(url, "anon") },
  });
}

export async function getCursor(jobName) {
  const { data, error } = await supabaseAdmin
    .from("import_state")
    .select("cursor, rows_processed, notes")
    .eq("job_name", jobName)
    .maybeSingle();
  if (error) throw error;
  return data || { cursor: null, rows_processed: 0, notes: null };
}

export async function setCursor(jobName, cursor, rowsProcessed, notes = null) {
  const { error } = await supabaseAdmin
    .from("import_state")
    .upsert({
      job_name: jobName,
      cursor,
      rows_processed: rowsProcessed,
      last_run_at: new Date().toISOString(),
      notes,
    });
  if (error) throw error;
}
