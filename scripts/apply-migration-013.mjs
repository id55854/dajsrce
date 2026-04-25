// Apply supabase/migrations/013_ngo_registry.sql via direct Postgres connection.
// Requires SUPABASE_DB_PASSWORD in env (or .env.local) — Supabase project DB
// password from Settings → Database → Connection string.
//
// If you'd rather paste the SQL into the Supabase SQL editor, you don't need
// this script — but having a runner makes re-applies idempotent and scriptable.
//
// Usage:
//   SUPABASE_DB_PASSWORD=... node scripts/apply-migration-013.mjs
//   node scripts/apply-migration-013.mjs --file 013_ngo_registry.sql

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./lib/supabase-admin.mjs"; // side-effect: loads .env.local
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const FILE = argVal("--file", "013_ngo_registry.sql");
const sqlPath = path.resolve(__dirname, "..", "supabase", "migrations", FILE);
if (!fs.existsSync(sqlPath)) {
  console.error("Migration file not found:", sqlPath);
  process.exit(1);
}
const sql = fs.readFileSync(sqlPath, "utf-8");

const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const password = process.env.SUPABASE_DB_PASSWORD;
if (!projectRef) {
  console.error("Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL.");
  process.exit(1);
}
if (!password) {
  console.error("SUPABASE_DB_PASSWORD missing.");
  console.error("Get it from Supabase → Settings → Database → Connection string,");
  console.error("then add  SUPABASE_DB_PASSWORD=<password>  to .env.local");
  process.exit(1);
}

// Prefer the Supabase pooler (works from anywhere); fall back to direct.
const candidates = [
  `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`,
  `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require`,
  `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
];

let lastErr;
for (const cs of candidates) {
  const safe = cs.replace(/:([^:@]+)@/, ":***@");
  console.log(`Trying: ${safe}`);
  const client = new pg.Client({ connectionString: cs });
  try {
    await client.connect();
    console.log("Connected. Applying migration:", FILE);
    await client.query(sql);
    console.log("Migration applied successfully.");
    await client.end();
    process.exit(0);
  } catch (e) {
    lastErr = e;
    console.warn(`  failed: ${e.message}`);
    try { await client.end(); } catch {}
  }
}
console.error("\nAll connection attempts failed.");
console.error(lastErr);
process.exit(1);
