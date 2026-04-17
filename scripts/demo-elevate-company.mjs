/**
 * Elevate a company's subscription_tier in Supabase (demo / QA only).
 * Use when Stripe is not configured or you need Enterprise for a recording.
 *
 * Usage:
 *   node scripts/demo-elevate-company.mjs --slug my-company-slug --tier enterprise
 *   node scripts/demo-elevate-company.mjs --id <uuid> --tier sme_plus
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Tiers: free | sme_tax | sme_plus | enterprise
 */
import { createClient } from "@supabase/supabase-js";

const TIERS = new Set(["free", "sme_tax", "sme_plus", "enterprise"]);

function parseArgs() {
  const out = { slug: null, id: null, tier: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--slug") out.slug = argv[++i] ?? null;
    else if (argv[i] === "--id") out.id = argv[++i] ?? null;
    else if (argv[i] === "--tier") out.tier = argv[++i] ?? null;
  }
  return out;
}

const { slug, id, tier } = parseArgs();
if ((!slug && !id) || !tier || !TIERS.has(tier)) {
  console.error(
    "Usage: node scripts/demo-elevate-company.mjs (--slug SLUG | --id UUID) --tier <free|sme_tax|sme_plus|enterprise>"
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key);

let companyId = id;
if (!companyId && slug) {
  const { data, error } = await admin.from("companies").select("id").eq("slug", slug).maybeSingle();
  if (error || !data?.id) {
    console.error(error?.message ?? "Company not found for slug");
    process.exit(1);
  }
  companyId = data.id;
}

const status = tier === "free" ? "inactive" : "active";

const { error: upErr } = await admin
  .from("companies")
  .update({ subscription_tier: tier, subscription_status: status })
  .eq("id", companyId);

if (upErr) {
  console.error(upErr.message);
  process.exit(1);
}

console.log(`OK: company ${companyId} → tier=${tier}, subscription_status=${status}`);
