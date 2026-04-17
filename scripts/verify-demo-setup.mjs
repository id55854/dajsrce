/**
 * Checks that `.env.local` has the keys needed for a full demo (no secret values printed).
 *
 *   node scripts/verify-demo-setup.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.local");

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
];

const DEMO_RECOMMENDED = [
  "NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED",
  "NEXT_PUBLIC_FLAG_EXPORTS_ENABLED",
  "NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED",
  "ALLOW_DEMO_BILLING",
];

function parseEnvFile(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function isTruthy(v) {
  if (v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function row(ok, label) {
  console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}`);
  return ok;
}

const env = parseEnvFile(envPath);
if (!env) {
  console.error("Missing .env.local — copy .env.example and fill in secrets.");
  process.exit(1);
}

console.log("Demo setup check (.env.local)\n");

let allOk = true;
console.log("Required:");
for (const k of REQUIRED) {
  const ok = Boolean(env[k] && String(env[k]).length > 0);
  allOk = row(ok, k) && allOk;
}

console.log("\nRecommended for demo recording:");
for (const k of DEMO_RECOMMENDED) {
  const ok = isTruthy(env[k]);
  allOk = row(ok, `${k}=true`) && allOk;
}

console.log("\nStill manual (dashboard / CLI):");
console.log("  • Supabase SQL: apply migrations 001→010 (SQL editor or supabase db push).");
console.log("  • Supabase Auth: Site URL + Redirect URLs must include NEXT_PUBLIC_APP_URL.");
console.log("  • Vercel: copy the same env vars to Project → Settings → Environment Variables.");
console.log("  • Optional: disable email confirmation on the demo project for faster sign-up.");

process.exit(allOk ? 0 : 1);
