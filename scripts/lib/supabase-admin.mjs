// Shared service-role Supabase client + tiny env loader so scripts can be run
// directly with `node scripts/foo.mjs` without `dotenv`.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

export const supabaseAdmin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
