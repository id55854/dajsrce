// Apply supabase/migrations/014_ngo_registry.sql via direct Postgres connection.
// Requires SUPABASE_DB_PASSWORD in env (or .env.local) — Supabase project DB
// password from Settings → Database → Connection string.
//
// If you'd rather paste the SQL into the Supabase SQL editor, you don't need
// this script — but having a runner makes re-applies idempotent and scriptable.
//
// Usage:
//   SUPABASE_DB_PASSWORD=... node scripts/apply-migration-014.mjs
//   node scripts/apply-migration-014.mjs --file 014_ngo_registry.sql

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

const FILE = argVal("--file", "014_ngo_registry.sql");
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

// Try pooler hosts (Supabase Shared Pooler, multiple regions).
const candidates = [
  { host: `aws-0-eu-central-1.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-1-eu-central-1.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-eu-central-2.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-eu-west-1.pooler.supabase.com`,    port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-eu-west-2.pooler.supabase.com`,    port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-eu-west-3.pooler.supabase.com`,    port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-us-east-1.pooler.supabase.com`,    port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-us-east-2.pooler.supabase.com`,    port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-us-west-1.pooler.supabase.com`,    port: 6543, user: `postgres.${projectRef}` },
  { host: `aws-0-ap-southeast-1.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
  // Direct connection — only works on IPv6-capable networks.
  { host: `db.${projectRef}.supabase.co`, port: 5432, user: `postgres` },
];

let lastErr;
for (const c of candidates) {
  console.log(`Trying: ${c.user}@${c.host}:${c.port}`);
  const client = new pg.Client({
    host: c.host,
    port: c.port,
    user: c.user,
    password,
    database: "postgres",
    // Supabase pooler presents a cert that Node's default CA bundle doesn't
    // recognise; we still encrypt the connection but skip CA verification.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
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
