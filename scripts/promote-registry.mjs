// Set-based promotion of reviewed registry rows into public institutions.
// Registry records never infer public donation acceptance; organizations must
// explicitly claim and confirm that capability.

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const dryRun = flag("--dry-run");
const requestedLimit = argVal("--limit") ? Number.parseInt(argVal("--limit"), 10) : 500;
const limit = Math.min(5_000, Math.max(1, requestedLimit));
const minConfidence = Number.parseFloat(argVal("--min-confidence", "0.7"));

if (!Number.isFinite(minConfidence) || minConfidence < 0.7 || minConfidence > 1) {
  throw new Error("--min-confidence must be between 0.7 and 1.0");
}

const { data, error } = await supabaseAdmin.rpc("promote_registry_batch", {
  p_min_confidence: minConfidence,
  p_limit: limit,
  p_dry_run: dryRun,
});
if (error) throw error;

console.log("=== Registry promotion report ===");
console.log(JSON.stringify(data, null, 2));
if (dryRun) {
  console.log("[DRY RUN] Counts use the same database candidate set; no rows were written.");
} else {
  console.log("Only auto-eligible, high-confidence, exact/street-geocoded records were promoted.");
  console.log("Donation acceptance remains false until an organization confirms it.");
}
